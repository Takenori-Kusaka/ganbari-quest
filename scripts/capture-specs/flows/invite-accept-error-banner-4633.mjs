/**
 * scripts/capture-specs/flows/invite-accept-error-banner-4633.mjs
 *
 * Issue #4633 AC-A: 招待受諾が拒否されたとき、admin に「なぜ参加できなかったか + 次アクション」の
 * 案内バナーが出ることの before / after SS。
 *
 * 受諾拒否は理由を通知 cookie (`invite_accept_error`) に積み、admin +layout.server.ts が
 * 読み取って即消費する。ここでは cookie を直接積むことで、招待受諾の実フロー
 * (cognito + DSQL が要る、local backend では原理的に検証不能 #3732) を通さずに
 * 「拒否理由 → 画面に何が出るか」だけを決定的に撮る。
 *
 * 撮影する 2 コマ (どちらの build でも同じ操作列):
 *   1. TENANT_NOT_FOUND (猶予期間の世帯からの招待が落ちたときの理由)
 *      - 修正前 (origin/main, SS_PHASE=before-*): 許可リストが email 束縛 2 理由限定のため
 *        バナーは出ず、無説明の空 admin に着地する
 *      - 修正後 (本 PR, SS_PHASE=after-*): 理由 + 次アクションのバナーが出る
 *   2. ALREADY_IN_TENANT (既に別グループに所属していて受諾できなかったとき)
 *      - 修正前: 同上 (無音)
 *      - 修正後: バナーが出る
 *
 * 使用例 (dev server = AUTH_MODE=local を別途起動):
 *   SS_PHASE=after BASE_URL=http://localhost:5173 \
 *     node scripts/capture.mjs \
 *     --flow invite-accept-error-banner-4633 \
 *     --url /admin \
 *     --actions scripts/capture-specs/flows/invite-accept-error-banner-4633.mjs \
 *     --presets desktop --pr 4634
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PHASE = process.env.SS_PHASE || 'after';

/** 通知 cookie は admin +layout.server.ts が 1 回読んだら消すため、コマごとに積み直す。 */
async function seedReasonCookie(page, reason) {
	const url = new URL(BASE_URL);
	await page.context().addCookies([
		{
			name: 'invite_accept_error',
			value: reason,
			domain: url.hostname,
			path: '/',
		},
	]);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const reason of ['TENANT_NOT_FOUND', 'ALREADY_IN_TENANT']) {
		await seedReasonCookie(page, reason);
		await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
		// バナーは SSR 出力に含まれる (server load の戻り値)。修正前 build では出ないため
		// 存在待ちはせず、レイアウトが描画され切ったところで撮る。
		await page.locator('main, [data-testid="admin-resource-header"], body').first().waitFor();
		await page.waitForTimeout(300);
		await capture(`${PHASE}-invite-accept-error-${reason.toLowerCase().replace(/_/g, '-')}`);
	}
};
