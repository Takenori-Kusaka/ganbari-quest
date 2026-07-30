// tests/e2e/admin-challenges-delete-confirm.spec.ts
//
// #4023 横展開: admin/challenges の削除確認が「キャンセルしても削除される」状態だった回帰を固定する。
//
// 旧実装は `<form use:enhance onsubmit={(e) => { if (!confirm(...)) e.preventDefault(); }}>` で、
// use:enhance が form に自前で登録する submit listener は defaultPrevented を見ない
// (@sveltejs/kit/src/runtime/app/forms.js:121 handle_submit) ため、キャンセルしても
// ?/delete action が実行されていた。admin/settings/rules と完全に同型の欠陥。
//
// 「確認ダイアログが出ること」だけを見る test では本バグを検出できない (旧実装でも
// native confirm は出ていた) ため、**child_challenges の実データが残ることを assert する**。

import { expect, test } from './fixtures';

const ELEMENTARY_NICKNAME = 'けんたくん';
// sentinel: auto:weekly の unique index を避けつつ cleanup を精密化する。
const SEED_SOURCE = 'e2e-4023-delete-confirm';
const SEED_TITLE = 'E2E削除確認チャレンジ';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
function jstDate(offsetDays: number): string {
	const ms = Date.now() + JST_OFFSET_MS + offsetDays * 24 * 60 * 60 * 1000;
	return new Date(ms).toISOString().slice(0, 10);
}

async function seedChallenge(workerDbPath: string): Promise<number> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get(ELEMENTARY_NICKNAME) as { id: number } | undefined;
		if (!child) throw new Error(`${ELEMENTARY_NICKNAME} not found in worker DB`);

		const info = db
			.prepare(
				`INSERT INTO child_challenges (
					child_id, title, description, challenge_type, period_type,
					start_date, end_date, target_config, reward_config,
					status, is_active, source_template_id,
					current_value, target_value, completed, completed_at,
					reward_claimed, reward_claimed_at
				) VALUES (?, ?, ?, 'cooperative', 'weekly', ?, ?, ?, ?, 'active', 1, ?, 0, 5, 0, NULL, 0, NULL)`,
			)
			.run(
				child.id,
				SEED_TITLE,
				'#4023 delete confirm test',
				jstDate(-3),
				jstDate(10),
				JSON.stringify({ metric: 'count', categoryId: 1, baseTarget: 5 }),
				JSON.stringify({ points: 10, message: 'よくがんばったね' }),
				SEED_SOURCE,
			);
		return Number(info.lastInsertRowid);
	} finally {
		db.close();
	}
}

async function challengeExists(workerDbPath: string, challengeId: number): Promise<boolean> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath, { readonly: true });
	try {
		const row = db.prepare('SELECT id FROM child_challenges WHERE id = ?').get(challengeId) as
			| { id: number }
			| undefined;
		return row !== undefined;
	} finally {
		db.close();
	}
}

async function cleanupSeeded(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare('DELETE FROM child_challenges WHERE source_template_id = ?').run(SEED_SOURCE);
	} finally {
		db.close();
	}
}

/**
 * admin/challenges を開き hydration 完了まで待つ。
 *
 * 確認ダイアログは Ark UI `<Portal>` 配下で client mount 後にのみ DOM に現れるため、
 * その attach を hydration gate として使う。hydration 前に削除ボタンを押すと
 * `use:enhance` が未装着で native form submit (= 確認なしで削除) になり、
 * 「確認が効かない」ではなく「JS 未起動」を測ってしまう。
 */
async function gotoChallengesPage(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/admin/challenges', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('admin-challenges-confirm-dialog')).toHaveCount(1, {
		timeout: 30_000,
	});
}

test.describe('#4023 横展開 admin/challenges 削除確認', () => {
	test.setTimeout(180_000);

	test.afterEach(async ({ workerDbPath }) => {
		await cleanupSeeded(workerDbPath);
	});

	test('削除のキャンセルで child_challenges の行が残る', async ({ page, workerDbPath }) => {
		test.slow();
		const challengeId = await seedChallenge(workerDbPath);
		await gotoChallengesPage(page);

		const deleteButton = page.getByTestId(`admin-challenge-delete-${challengeId}`);
		await expect(deleteButton).toBeVisible({ timeout: 30_000 });
		await deleteButton.click();

		// 確認ダイアログが出る (結果を書いた文言)
		const dialog = page.getByTestId('admin-challenges-confirm-dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText(SEED_TITLE);

		// キャンセル
		await page.getByTestId('admin-challenges-confirm-cancel').click();
		await expect(dialog).toBeHidden();

		// 実データが残っていること (これが本 test の核。キャンセルを素通しさせると行が消えて fail する)
		expect(await challengeExists(workerDbPath, challengeId)).toBe(true);

		// reload しても一覧に残る
		await gotoChallengesPage(page);
		await expect(page.getByTestId(`admin-challenge-delete-${challengeId}`)).toBeVisible({
			timeout: 30_000,
		});
	});

	test('確認を承認すると child_challenges の行が消える', async ({ page, workerDbPath }) => {
		test.slow();
		const challengeId = await seedChallenge(workerDbPath);
		await gotoChallengesPage(page);

		await page.getByTestId(`admin-challenge-delete-${challengeId}`).click();
		await expect(page.getByTestId('admin-challenges-confirm-dialog')).toBeVisible();
		await page.getByTestId('admin-challenges-confirm-accept').click();

		await expect
			.poll(() => challengeExists(workerDbPath, challengeId), { timeout: 30_000 })
			.toBe(false);
	});
});
