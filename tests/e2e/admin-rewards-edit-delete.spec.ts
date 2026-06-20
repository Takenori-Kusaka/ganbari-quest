// tests/e2e/admin-rewards-edit-delete.spec.ts
// #2832: reward 編集 / 削除の pending redemption ガード E2E
//
// AC1: pending redemption が存在する reward の削除は拒否され、理由メッセージ
//      (labels SSOT: deletePendingBlocked) が 2 層 feedback (Toast + banner) で表示される
// AC2 (案 b): 編集は pending 中も許容され、編集 dialog に「申請済みの交換は申請時点の
//      内容で処理されます」note が表示される
// AC3 補完: pending 解消 (却下) 後は削除が成功する
//
// テスト設計 (tests/CLAUDE.md §interactive flow): render-only 禁止。
// click → network / banner / 一覧反映 の outcome を必ず assert する。
// seed は worker DB 直接挿入 (child-shop-exchange.spec.ts の insertPendingRedemption と同型)。

import { expect, type Locator, test } from './fixtures';

const REWARD_TITLE_PREFIX = '削除ガードE2E';

/**
 * Ark UI Dialog primitive の trigger button を click し dialog が open になるまで最大 5 attempt
 * retry する (`admin-activities-delete.spec.ts:openDeleteDialog` と同設計)。
 * Svelte 5 の onclick は hydration 完了後にのみ bind されるため、Vite dev cold compile 直後の
 * click が無反応になる race を吸収する。ADR-0006 適合: assertion は強化方向 (toBeVisible hard
 * signal)、interaction retry のみで安定化。
 */
async function openDialogWithRetry(triggerBtn: Locator, dialog: Locator): Promise<void> {
	await expect(triggerBtn).toBeVisible();
	await expect(triggerBtn).toBeEnabled();
	await triggerBtn.scrollIntoViewIfNeeded();
	for (let attempt = 0; attempt < 5; attempt++) {
		await triggerBtn.click();
		try {
			await expect(dialog).toBeVisible({ timeout: 2_000 });
			return;
		} catch {
			// hydration race / 再 click で吸収
		}
	}
	await expect(dialog, 'dialog not visible after 5 attempts').toBeVisible({ timeout: 5_000 });
}

interface SeededReward {
	childId: number;
	rewardId: number;
	title: string;
}

/** 最初の child (admin/rewards の default 選択タブ) に専用 reward を直接 seed する */
async function seedReward(workerDbPath: string, suffix: string): Promise<SeededReward> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const child = db.prepare('SELECT MIN(id) AS id FROM children').get() as
			| { id: number }
			| undefined;
		if (!child?.id) throw new Error('No children seeded (global-setup.ts)');
		const title = `${REWARD_TITLE_PREFIX}-${suffix}-${Date.now()}`;
		const result = db
			.prepare(
				`INSERT INTO special_rewards (child_id, title, points, icon, category, granted_at)
				 VALUES (?, ?, 50, '🎁', 'とくべつ', CURRENT_TIMESTAMP)`,
			)
			.run(child.id, title);
		return { childId: child.id, rewardId: Number(result.lastInsertRowid), title };
	} finally {
		db.close();
	}
}

/** seed reward に pending redemption を直接挿入する */
async function insertPendingRedemption(
	workerDbPath: string,
	seeded: SeededReward,
): Promise<number> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const result = db
			.prepare(
				`INSERT INTO reward_redemption_requests
				 (child_id, reward_id, requested_at, status, reward_title, reward_points, reward_icon)
				 VALUES (?, ?, ?, 'pending_parent_approval', ?, 50, '🎁')`,
			)
			.run(seeded.childId, seeded.rewardId, Math.floor(Date.now() / 1000), seeded.title);
		return Number(result.lastInsertRowid);
	} finally {
		db.close();
	}
}

/** pending redemption を却下済 (解決済) にする */
async function resolveRedemption(workerDbPath: string, requestId: number): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare(
			`UPDATE reward_redemption_requests
			 SET status = 'rejected', resolved_at = ? WHERE id = ?`,
		).run(Math.floor(Date.now() / 1000), requestId);
	} finally {
		db.close();
	}
}

/** 本 spec が seed した reward / redemption を完全クリーンアップ (他 spec への汚染防止) */
async function cleanupSeededRewards(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare(
			`DELETE FROM reward_redemption_requests WHERE reward_id IN
			 (SELECT id FROM special_rewards WHERE title LIKE '${REWARD_TITLE_PREFIX}%')`,
		).run();
		db.prepare(`DELETE FROM special_rewards WHERE title LIKE '${REWARD_TITLE_PREFIX}%'`).run();
	} finally {
		db.close();
	}
}

test.describe('#2832 reward 編集/削除の pending redemption ガード', () => {
	test.afterEach(async ({ workerDbPath }) => {
		await cleanupSeededRewards(workerDbPath);
	});

	test('AC1: pending redemption 中の削除は拒否され理由メッセージが表示される (削除 dialog cancel 含む)', async ({
		page,
		workerDbPath,
	}) => {
		test.slow();
		const seeded = await seedReward(workerDbPath, 'ac1');
		await insertPendingRedemption(workerDbPath, seeded);

		await page.goto('/admin/rewards', { waitUntil: 'domcontentloaded' });
		const rewardItem = page.getByTestId(`reward-item-${seeded.rewardId}`);
		await expect(rewardItem).toBeVisible({ timeout: 30_000 });

		// 一覧上で処理待ちバッジが見える (NN/G #1 visibility)
		await expect(page.getByTestId(`reward-pending-badge-${seeded.rewardId}`)).toBeVisible();

		// 削除 dialog open → cancel 経路の検証 (dialog cancel 不能 dead-end の検出)
		const deleteDialog = page.getByTestId('reward-delete-dialog');
		await openDialogWithRetry(
			page.getByTestId(`reward-delete-btn-${seeded.rewardId}`),
			deleteDialog,
		);
		// pending 警告が dialog 内に先出しされる
		await expect(page.getByTestId('reward-delete-pending-warning')).toBeVisible();
		await deleteDialog.getByRole('button', { name: 'キャンセル' }).click();
		await expect(deleteDialog).toBeHidden();

		// 再度開いて削除確定 → server guard (409) → 拒否メッセージ (2 層 feedback の banner 層)
		await openDialogWithRetry(
			page.getByTestId(`reward-delete-btn-${seeded.rewardId}`),
			deleteDialog,
		);
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/delete/.test(r.url())),
			page.getByTestId('reward-delete-confirm').click(),
		]);
		// fail(409) は HTTP 409 で返る (SvelteKit form action は fail の status を反映する)
		expect([200, 409]).toContain(resp.status());

		const banner = page.getByTestId('rewards-action-message');
		await expect(banner).toBeVisible({ timeout: 10_000 });
		await expect(banner).toContainText('交換申請が処理待ちのため削除できません');

		// reward は削除されていない (一覧に残る)
		await expect(rewardItem).toBeVisible();
	});

	test('AC3: pending 解消 (却下) 後は削除が成功し一覧から消える', async ({
		page,
		workerDbPath,
	}) => {
		test.slow();
		const seeded = await seedReward(workerDbPath, 'ac3');
		const requestId = await insertPendingRedemption(workerDbPath, seeded);
		await resolveRedemption(workerDbPath, requestId);

		await page.goto('/admin/rewards', { waitUntil: 'domcontentloaded' });
		const rewardItem = page.getByTestId(`reward-item-${seeded.rewardId}`);
		await expect(rewardItem).toBeVisible({ timeout: 30_000 });

		const deleteDialog = page.getByTestId('reward-delete-dialog');
		await openDialogWithRetry(
			page.getByTestId(`reward-delete-btn-${seeded.rewardId}`),
			deleteDialog,
		);

		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/delete/.test(r.url())),
			page.getByTestId('reward-delete-confirm').click(),
		]);
		expect(resp.ok()).toBeTruthy();

		// outcome: 成功 banner + 一覧から消える (invalidateAll 反映)
		const banner = page.getByTestId('rewards-action-message');
		await expect(banner).toBeVisible({ timeout: 10_000 });
		await expect(banner).toContainText('ごほうびを削除しました');
		await expect(page.getByTestId(`reward-item-${seeded.rewardId}`)).toHaveCount(0, {
			timeout: 10_000,
		});
	});

	test('AC2 (案 b): pending 中も編集は成功し、編集 dialog に申請時点 snapshot note が表示される', async ({
		page,
		workerDbPath,
	}) => {
		test.slow();
		const seeded = await seedReward(workerDbPath, 'ac2');
		await insertPendingRedemption(workerDbPath, seeded);

		await page.goto('/admin/rewards', { waitUntil: 'domcontentloaded' });
		const rewardItem = page.getByTestId(`reward-item-${seeded.rewardId}`);
		await expect(rewardItem).toBeVisible({ timeout: 30_000 });

		const editDialog = page.getByTestId('reward-edit-dialog');
		await openDialogWithRetry(page.getByTestId(`reward-edit-btn-${seeded.rewardId}`), editDialog);

		// AC2: 「申請済みの交換は申請時点の内容（名前・ポイント）で処理されます」note
		const note = page.getByTestId('reward-edit-pending-note');
		await expect(note).toBeVisible();
		await expect(note).toContainText('申請時点の内容');

		// 編集確定 → 成功 banner + 一覧へ新タイトル反映
		const newTitle = `${seeded.title}-編集済`;
		const titleInput = editDialog.getByLabel('タイトル');
		await titleInput.fill(newTitle);
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/update/.test(r.url())),
			page.getByTestId('reward-edit-confirm').click(),
		]);
		expect(resp.ok()).toBeTruthy();

		const banner = page.getByTestId('rewards-action-message');
		await expect(banner).toBeVisible({ timeout: 10_000 });
		await expect(banner).toContainText('ごほうびを更新しました');
		await expect(page.getByTestId(`reward-item-${seeded.rewardId}`)).toContainText(newTitle, {
			timeout: 10_000,
		});
	});

	test('#3154: 編集 dialog でショップ陳列系統 (shop_category) を変更すると DB に反映される', async ({
		page,
		workerDbPath,
	}) => {
		test.slow();
		const seeded = await seedReward(workerDbPath, 'shopcat');

		await page.goto('/admin/rewards', { waitUntil: 'domcontentloaded' });
		const rewardItem = page.getByTestId(`reward-item-${seeded.rewardId}`);
		await expect(rewardItem).toBeVisible({ timeout: 30_000 });

		const editDialog = page.getByTestId('reward-edit-dialog');
		await openDialogWithRetry(page.getByTestId(`reward-edit-btn-${seeded.rewardId}`), editDialog);

		// 陳列系統セレクトで 'money' (お小遣い) を選択 → 編集確定 (act → outcome)
		await editDialog.getByTestId('reward-edit-shop-category').selectOption('money');
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/update/.test(r.url())),
			page.getByTestId('reward-edit-confirm').click(),
		]);
		expect(resp.ok()).toBeTruthy();
		await expect(page.getByTestId('rewards-action-message')).toBeVisible({ timeout: 10_000 });

		// DB に shop_category='money' が永続したことを検証 (登録後の陳列系統変更が効く)
		const { default: Database } = await import('better-sqlite3');
		const db = new Database(workerDbPath);
		try {
			const row = db
				.prepare('SELECT shop_category FROM special_rewards WHERE id = ?')
				.get(seeded.rewardId) as { shop_category: string | null } | undefined;
			expect(row?.shop_category).toBe('money');
		} finally {
			db.close();
		}
	});
});
