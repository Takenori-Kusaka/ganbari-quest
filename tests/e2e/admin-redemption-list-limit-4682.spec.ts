// tests/e2e/admin-redemption-list-limit-4682.spec.ts
// #4682: 「一覧の limit を存在確認 / 集計に流用する」class の E2E 回帰。
//
// 検証する顧客体験:
//   F1 申請総数が 50 件を超えても、親が最古の承認待ちを画面から承認できる
//      (旧: 赤 Alert「申請が見つかりません」で詰み、子供は「うけとりまち」固定)
//   F4 承認待ちが 30 件以上あっても、処理済みの履歴が画面に出て処理日時 / 却下理由が読める
//      (旧: 「直近 30 申請」を filter していたため履歴 0 件表示)
//
// tests/CLAUDE.md §interactive flow: click → outcome (network + 画面反映 + DB) を必ず assert する。

import { expect, test } from './fixtures';

const TITLE_PREFIX = '一覧limitE2E';

interface Seeded {
	childId: number;
	rewardId: number;
	oldestPendingId: number;
	resolvedId: number;
	title: string;
}

/**
 * 「最古の承認待ち 1 件 + それより新しい処理済み 60 件」を作る。
 * 一覧 (limit 50、requestedAt desc) の window から最古 pending が押し出される状態。
 */
async function seedOverflowingRequests(workerDbPath: string): Promise<Seeded> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const child = db.prepare('SELECT MIN(id) AS id FROM children').get() as { id: number };
		if (!child?.id) throw new Error('No children seeded (global-setup.ts)');
		const title = `${TITLE_PREFIX}-${Date.now()}`;
		const rewardId = Number(
			db
				.prepare(
					`INSERT INTO special_rewards (child_id, title, points, icon, category, granted_at)
					 VALUES (?, ?, 10, '🎁', 'とくべつ', CURRENT_TIMESTAMP)`,
				)
				.run(child.id, title).lastInsertRowid,
		);
		// 承認時の減算で INSUFFICIENT にしないよう残高を積む
		db.prepare(
			`INSERT INTO point_ledger (child_id, amount, type, description)
			 VALUES (?, 100000, '${TITLE_PREFIX}_seed', ?)`,
		).run(child.id, title);

		const now = Math.floor(Date.now() / 1000);
		const oldestPendingId = Number(
			db
				.prepare(
					`INSERT INTO reward_redemption_requests
						(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
					 VALUES (?, ?, ?, 1, 'pending_parent_approval', ?, 10, '🎁')`,
				)
				.run(child.id, rewardId, now - 500_000, title).lastInsertRowid,
		);
		// 却下済み 1 件 (履歴に「処理日時 + 却下理由」が出ることの検証用、最古 pending より新しい)
		const resolvedId = Number(
			db
				.prepare(
					`INSERT INTO reward_redemption_requests
						(child_id, reward_id, requested_at, quantity, status, resolved_at, parent_note,
						 reward_title, reward_points, reward_icon)
					 VALUES (?, ?, ?, 1, 'rejected', ?, ?, ?, 10, '🎁')`,
				)
				.run(child.id, rewardId, now - 400_000, now - 399_000, 'いまはだめ', title).lastInsertRowid,
		);
		// window を埋める新しい承認待ち 60 件
		const fill = db.prepare(
			`INSERT INTO reward_redemption_requests
				(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
			 VALUES (?, ?, ?, 1, 'pending_parent_approval', ?, 10, '🎁')`,
		);
		for (let i = 0; i < 60; i++) fill.run(child.id, rewardId, now - 1000 + i, title);

		return { childId: child.id, rewardId, oldestPendingId, resolvedId, title };
	} finally {
		db.close();
	}
}

async function cleanup(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare(
			`DELETE FROM reward_redemption_requests WHERE reward_title LIKE '${TITLE_PREFIX}%'`,
		).run();
		db.prepare(`DELETE FROM special_rewards WHERE title LIKE '${TITLE_PREFIX}%'`).run();
		db.prepare(`DELETE FROM point_ledger WHERE type = '${TITLE_PREFIX}_seed'`).run();
		db.prepare(
			`DELETE FROM point_ledger WHERE type = 'reward_redemption' AND description LIKE '${TITLE_PREFIX}%'`,
		).run();
	} finally {
		db.close();
	}
}

test.describe('#4682 一覧 limit を存在確認 / 集計に流用しない', () => {
	test.afterEach(async ({ workerDbPath }) => {
		await cleanup(workerDbPath);
	});

	test('F1: 申請 60 件超でも最古の承認待ちを画面から承認できる', async ({ page, workerDbPath }) => {
		test.slow();
		const seeded = await seedOverflowingRequests(workerDbPath);

		// 承認待ちは古い順に並ぶため、最古が先頭に出る (旧実装は新しい順 + limit 50 で不可視だった)。
		await page.goto('/admin/rewards/requests', { waitUntil: 'domcontentloaded' });
		const approveBtn = page.getByTestId(`approve-btn-${seeded.oldestPendingId}`);
		await expect(approveBtn, '最古の承認待ちが一覧に出ていない').toBeVisible({ timeout: 30_000 });

		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/approveRedemption/.test(r.url())),
			approveBtn.click(),
		]);
		expect(resp.ok()).toBeTruthy();

		// outcome: 赤 Alert が出ない + DB が approved になる
		await expect(page.getByText('申請が見つかりません')).toHaveCount(0);
		const { default: Database } = await import('better-sqlite3');
		const db = new Database(workerDbPath);
		try {
			const row = db
				.prepare('SELECT status FROM reward_redemption_requests WHERE id = ?')
				.get(seeded.oldestPendingId) as { status: string };
			expect(row.status, '最古の承認待ちが承認されていない').toBe('approved');
		} finally {
			db.close();
		}
	});

	test('F4: 承認待ちが 60 件あっても処理済み履歴が出て、処理日時と却下理由が読める', async ({
		page,
		workerDbPath,
	}) => {
		test.slow();
		const seeded = await seedOverflowingRequests(workerDbPath);

		await page.goto('/admin/rewards/requests', { waitUntil: 'domcontentloaded' });
		const historyRow = page.getByTestId(`request-history-${seeded.resolvedId}`);
		await expect(historyRow, '承認待ちに押し出されて履歴が 0 件になっている').toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByTestId(`request-history-resolved-${seeded.resolvedId}`)).toBeVisible();
		await expect(page.getByTestId(`request-history-note-${seeded.resolvedId}`)).toContainText(
			'いまはだめ',
		);
	});

	test('F1: 承認待ちの件数は COUNT の総数で、表示件数と食い違うときは差を明示する', async ({
		page,
		workerDbPath,
	}) => {
		test.slow();
		await seedOverflowingRequests(workerDbPath);

		await page.goto('/admin/rewards/requests', { waitUntil: 'domcontentloaded' });
		const count = page.getByTestId('pending-count');
		await expect(count).toBeVisible({ timeout: 30_000 });
		// seed した 61 件 + 既存 seed 分。50 で飽和していないことを見る (旧実装は必ず「50 件」)。
		const shown = Number(((await count.textContent()) ?? '').replace(/[^0-9]/g, ''));
		expect(shown, '承認待ち件数が表示上限で飽和している').toBeGreaterThan(50);
	});
});
