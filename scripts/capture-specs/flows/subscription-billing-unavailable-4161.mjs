/**
 * scripts/capture-specs/flows/subscription-billing-unavailable-4161.mjs
 *
 * Issue #4161: 決済が有効でない配備 (STRIPE_SECRET_KEY 未設定 = セルフホスト / 設定不備) で
 * アップグレード CTA を押したときの before / after SS。
 *
 * 撮影する 1 コマ (どちらの build でも同じ操作列):
 *   「プレミアムへ」CTA を押した直後の /admin/subscription
 *     - 修正前 (origin/develop, SS_PHASE=before-*): `startCheckout()` に入り 503 で失敗する。
 *       画面内には何も出ない (checkout の Alert は `{#if stripeEnabled}` の内側にあり
 *       決済未設定では描画されない) ため、消える Toast だけが手掛かりになる
 *     - 修正後 (本 PR, SS_PHASE=after-*): 押した時点で理由を in-page banner で提示して打ち切る
 *
 * 使用例 (認証が要るので cognito server + standard の storageState を使う):
 *   SS_PHASE=after BASE_URL=http://localhost:5174 \
 *     node scripts/capture.mjs \
 *     --flow subscription-billing-unavailable-4161 \
 *     --url /admin/subscription \
 *     --actions scripts/capture-specs/flows/subscription-billing-unavailable-4161.mjs \
 *     --storage-state playwright/.auth/standard.json \
 *     --server-mode cognito --presets mobile,desktop --pr 4161
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE || 'after';
// 同一 PR 内で desktop / mobile を撮り分けるときのファイル名衝突を避ける (push 先は flat)
const VARIANT = process.env.SS_VARIANT ? `-${process.env.SS_VARIANT}` : '';

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

	await page.goto(`${BASE_URL}/admin/subscription`, { waitUntil: 'domcontentloaded' });

	// hydration gate: CTA は SSR でも <button> として描画されるため、hydration 前に押すと
	// onclick 未 attach で空振りし「押しても何も起きない画面」を撮ってしまう。
	// 確認ダイアログ content は Ark UI <Portal> 配下で client mount 後にのみ DOM に現れる
	// (前後どちらの build にも存在する) ので、それを gate に使う。
	await page.getByTestId('portal-confirm-button').waitFor({ state: 'attached', timeout: 60_000 });

	const cta = page.getByTestId('plan-status-family-cta');
	await cta.waitFor({ state: 'visible', timeout: 30_000 });
	await cta.click();

	const banner = page.getByTestId('billing-unavailable-alert');
	if (PHASE.startsWith('after')) {
		// 修正後 build で banner が出ないまま撮ると「直っていない画面」を後 SS として貼ってしまう。
		// 握りつぶさず throw して撮影自体を失敗させる (SS 捏造の構造的防止)。
		await banner.waitFor({ state: 'visible', timeout: 15_000 });
	} else {
		// 修正前 build: banner は存在しない。checkout の失敗 Toast (role="alert") が出るまで待つ。
		// Toast は自動で消えるため、出た直後に撮る。
		await page
			.getByRole('alert')
			.first()
			.waitFor({ state: 'visible', timeout: 15_000 })
			.catch(() => {});
	}

	await rafSettle();
	await capture(`${PHASE}-subscription-upgrade-cta${VARIANT}`);
};
