/**
 * scripts/capture-specs/flows/activities-bulk-limit-4693.mjs (#4693)
 *
 * `/admin/activities` の「+ 追加 → 複数のお子さまにまとめて追加」を上限到達状態で実行し、
 * 結果メッセージを撮る。
 *
 *   before … サーバーは 403 (PLAN_LIMIT_EXCEEDED) を返しているのに「一括追加しました」と出る
 *            (`resp.ok` 判定で fail() を成功として扱っていた)
 *   after  … 上限メッセージ + アップグレード導線が出る
 *
 * 上限到達は `DEBUG_PLAN=free` (#758) と、無料プラン上限 (カスタム活動 3 件) 到達済の
 * ローカル DB を前提にする。dev サーバー (`npm run dev`) で動かすこと
 * (DEBUG_PLAN は dev のみ有効)。
 *
 * 使用例:
 *   SS_PHASE=after BASE_URL=http://localhost:5173 node scripts/capture.mjs --pr <N> \
 *     --flow activities-bulk-limit \
 *     --url /admin/activities \
 *     --actions scripts/capture-specs/flows/activities-bulk-limit-4693.mjs \
 *     --presets desktop
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(`${BASE_URL}/admin/activities`, { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle').catch(() => {});

	// header の「+ 追加」dropdown → 「複数のお子さまにまとめて追加」
	await page
		.getByRole('button', { name: /追加/ })
		.first()
		.click()
		.catch(() => {});
	const bulkItem = page.getByRole('menuitem', { name: /まとめて追加|一括/ }).first();
	await bulkItem.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
	await bulkItem.click().catch(() => {});

	// 最小入力 (活動名だけ埋めれば送信できる)
	const nameField = page.getByLabel('活動名').first();
	await nameField.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
	await nameField.click().catch(() => {});
	await page.keyboard.type('上限テスト活動', { delay: 10 });

	// 「追加する」= 確定
	await page
		.getByRole('button', { name: /追加する/ })
		.first()
		.click()
		.catch(() => {});

	// 結果メッセージ (banner) が出るまで待つ
	await page
		.getByTestId('admin-activities-action-message')
		.waitFor({ state: 'visible', timeout: 20_000 })
		.catch(() => {});

	await capture(`${PHASE}-activities-bulk-limit`);
};
