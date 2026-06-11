/**
 * scripts/capture-specs/flows/admin-rewards-pending-guard-2832.mjs
 *
 * #2832: reward 編集/削除の pending redemption ガード UI 撮影。
 *
 * 撮影 4 状態:
 *   1. /admin/rewards の per-child reward 一覧 (処理待ちバッジ付き)
 *   2. 編集 dialog + 「申請済みの交換は申請時点の内容で処理されます」note (AC2 案 b)
 *   3. 削除確認 dialog (pending 警告先出し + 不可逆 note + danger Button)
 *   4. 削除確定 → ガード拒否メッセージ (2 層 feedback の banner 層、AC1)
 *
 * 前提: dev server (port 5173) の DB に「撮影用」タイトルの reward + pending redemption が
 * seed 済であること (PR 作業手順で better-sqlite3 直接挿入)。
 *
 * 使用例:
 *   node scripts/capture.mjs --flow admin-rewards-pending-guard-2832 \
 *     --url /admin/rewards \
 *     --actions scripts/capture-specs/flows/admin-rewards-pending-guard-2832.mjs \
 *     --presets desktop --pr 2832
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const SEED_TITLE = process.env.SEED_REWARD_TITLE || '撮影用ガードごほうび';

async function waitForDialogOpen(page, testid) {
	await page.waitForFunction(
		(t) => {
			const el = document.querySelector(`[data-testid="${t}"]`);
			if (!el) return false;
			return el.getAttribute('data-state') === 'open' && !el.hasAttribute('hidden');
		},
		testid,
		{ timeout: 15_000, polling: 100 },
	);
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) per-child reward 一覧 (処理待ちバッジ) ---
	await page.goto(`${BASE_URL}/admin/rewards`);
	const row = page
		.locator('[data-testid^="reward-item-"]')
		.filter({ hasText: SEED_TITLE })
		.first();
	await row.waitFor({ state: 'visible', timeout: 30_000 });
	await capture('2832-rewards-list-pending-badge');

	// --- 2) 編集 dialog + 申請時点 snapshot note (AC2 案 b) ---
	await row.locator('[data-testid^="reward-edit-btn-"]').click();
	await waitForDialogOpen(page, 'reward-edit-dialog');
	await page
		.getByTestId('reward-edit-pending-note')
		.waitFor({ state: 'visible', timeout: 10_000 });
	await capture('2832-reward-edit-dialog-pending-note');
	await page.keyboard.press('Escape');
	await page
		.getByTestId('reward-edit-dialog')
		.waitFor({ state: 'hidden', timeout: 10_000 })
		.catch(() => {});

	// --- 3) 削除確認 dialog (pending 警告 + 不可逆 note) ---
	await row.locator('[data-testid^="reward-delete-btn-"]').click();
	await waitForDialogOpen(page, 'reward-delete-dialog');
	await page
		.getByTestId('reward-delete-pending-warning')
		.waitFor({ state: 'visible', timeout: 10_000 });
	await capture('2832-reward-delete-dialog-pending-warning');

	// --- 4) 削除確定 → ガード拒否 banner (AC1) ---
	await page.getByTestId('reward-delete-confirm').click();
	await page.getByTestId('rewards-action-message').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('2832-reward-delete-blocked-banner');
};
