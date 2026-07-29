/**
 * scripts/capture-specs/flows/rules-reward-approval-confirm-4023.mjs
 *
 * Issue #4023: ごほうび交換の「親承認を外す」操作に確認ステップが無い問題の before / after SS。
 *
 * 撮影目的 (/admin/settings/rules の「ごほうび交換のしかた」セクション):
 *   - 修正前 (origin/develop build, SS_PHASE=before): 「即時交換にする」を押すと確認なしで
 *     即座に「承認なしで即時交換」に切り替わる (1 クリックで承認必須が外れる)
 *   - 修正後 (本 PR build, SS_PHASE=after): 同じ操作で確認ダイアログ
 *     (DESIGN.md §5 Dialog primitive) が出て、解除後に何が起きるかを提示する
 *
 * 使用例 (dev server = AUTH_MODE=local を別途起動してから):
 *   MSYS_NO_PATHCONV=1 SS_PHASE=after BASE_URL=http://localhost:5173 \
 *     node scripts/capture.mjs \
 *     --flow rules-reward-approval-confirm-4023 \
 *     --url /admin/settings/rules \
 *     --actions scripts/capture-specs/flows/rules-reward-approval-confirm-4023.mjs \
 *     --presets desktop,mobile --pr 4023
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
// before/after を SS ラベルで区別する (修正前 = origin/develop build で SS_PHASE=before)
const PHASE = process.env.SS_PHASE || 'after';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	const rafSettle = () =>
		page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);

	await page.goto(`${BASE_URL}/admin/settings/rules`, { waitUntil: 'domcontentloaded' });
	await page.getByTestId('admin-rules-page').waitFor({ state: 'visible', timeout: 30_000 });
	// hydration 待ち。修正後 build では確認ダイアログ (Ark Portal) が client mount 後に attach する。
	// 修正前 build には存在しないので timeout を握りつぶし、そのまま撮影に進む。
	await page
		.getByTestId('rules-confirm-dialog')
		.waitFor({ state: 'attached', timeout: 15_000 })
		.catch(() => {});

	// 「承認必須 → 即時交換」= 保護を外す方向のボタンを押す。
	// 修正後は確認ダイアログが出て止まる / 修正前はそのまま設定が切り替わる。
	const toggle = page.getByTestId('rules-reward-approval-toggle');
	await toggle.waitFor({ state: 'visible', timeout: 15_000 });
	await toggle.click();

	// 修正後のみ確認ダイアログが出る。修正前は timeout するので握りつぶし、
	// 「確認なしで切り替わった直後」の画面をそのまま撮る。
	await page
		.getByTestId('rules-confirm-dialog')
		.waitFor({ state: 'visible', timeout: 8_000 })
		.catch(() => {});
	await rafSettle();
	await capture(`pr4023-${PHASE}-reward-approval-remove-guard`);
};
