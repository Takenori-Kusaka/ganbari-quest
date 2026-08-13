/**
 * scripts/capture-specs/flows/subscription-portal-fallback-4548.mjs
 *
 * Issue #4548: 解約フォールバック通知の before / after SS。
 *
 * 通知は `$effect` (client 専用) が立てるため、**hydration 前に撮ると SSR HTML だけが写り
 * 「通知が無い画面」を貼ってしまう**。gate として通知そのものの出現を待ってから撮る。
 *
 * 撮り分け (SS_REASON):
 *   - no-subscription: ご契約情報が確認できず自力で解約を完了できない状態。
 *     修正後はサポート窓口ボタン (`portal-fallback-support`) が出る。修正前は同 param を
 *     読まないため一時障害と同じ文言に落ち、出口が無い (= 本 Issue の実害そのもの)
 *   - flow-rejected: Stripe が flow を拒否した一時障害。前後で不変であることの回帰確認
 *
 * 使用例 (認証が要るので cognito server + standard の storageState を使う):
 *   SS_PHASE=after SS_REASON=no-subscription BASE_URL=http://localhost:5186 \
 *     node scripts/capture.mjs \
 *     --flow subscription-portal-fallback-4548 \
 *     --url /admin/subscription \
 *     --actions scripts/capture-specs/flows/subscription-portal-fallback-4548.mjs \
 *     --storage-state tmp/auth-5186.json --presets desktop --out tmp/ss-after
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE || 'after';
const REASON = process.env.SS_REASON || 'no-subscription';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(
		`${BASE_URL}/admin/subscription?portalFallback=cancel&portalFallbackReason=${REASON}`,
		{ waitUntil: 'domcontentloaded' },
	);

	// 通知は client 側 `$effect` が立てる。出現を待たずに撮ると前後どちらの build でも
	// 「通知が無い画面」が撮れてしまい、SS が何も証明しない。
	await page.getByTestId('portal-fallback-notice').waitFor({ state: 'visible', timeout: 60_000 });

	// 修正後 × 恒久不能では、唯一の出口であるサポート導線が必ず出ていること。
	// 出ないまま撮ると「直っていない画面」を後 SS として貼ることになるので握り潰さない。
	if (PHASE.startsWith('after') && REASON === 'no-subscription') {
		await page
			.getByTestId('portal-fallback-support')
			.waitFor({ state: 'visible', timeout: 15_000 });
	}

	await capture(`${PHASE}-portal-fallback-${REASON}`);
};
