/**
 * scripts/capture-specs/flows/admin-list-limit-4682.mjs (#4682)
 *
 * 「一覧の limit を存在確認 / 集計に流用する」class の顧客影響を撮る SS フロー。
 *   1. /admin/rewards/requests の承認履歴 (処理済みが出るか / 処理日時・却下理由が読めるか)
 *   2. 最古の承認待ちを承認したときの結果 (成功 or 赤 Alert「申請が見つかりません」)
 *   3. /admin/points の「おこづかい変換りれき」と累計 (台帳が増えても消えないか)
 *
 * develop (修正前) でも同じ file を渡して before SS を撮れるよう、存在しない要素には触れず
 * 失敗しても続行する。撮影前の seed は呼び出し側が用意する (before / after を同一状態から撮るため)。
 *
 * 使用例 (AUTH_MODE=local の dev server、専用 port):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5199 node scripts/capture.mjs \
 *     --flow admin-list-limit-4682 \
 *     --url /admin/rewards/requests \
 *     --actions scripts/capture-specs/flows/admin-list-limit-4682.mjs \
 *     --presets mobile \
 *     --base-url http://localhost:5199 \
 *     --out tmp/screenshots/pr-<N>/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** seed 側と合わせる、承認する最古 pending の申請 id。 */
const OLDEST_PENDING_ID = process.env.SS_OLDEST_PENDING_ID || '';

/** @param {import('playwright').Page} page */
async function dismissOverlays(page) {
	for (let i = 0; i < 4; i++) {
		const dialog = page.locator('[data-part="content"][data-state="open"]').first();
		if ((await dialog.count()) === 0) return;
		const closeBtn = dialog
			.locator('button')
			.filter({ hasText: /とじる|やったね|閉じる|OK|わかった|つぎへ|おわり/ })
			.first();
		if ((await closeBtn.count()) > 0) await closeBtn.click().catch(() => {});
		await dialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
	}
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.context().clearCookies();

	// 1. 承認履歴 (承認待ちが大量にある状態で、処理済みが出るか)
	await page.goto(`${BASE_URL}/admin/rewards/requests`);
	await page
		.locator('h1, h2')
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 })
		.catch(() => {});
	await dismissOverlays(page);
	// 履歴セクションまでスクロールして撮る (一覧が長いので末尾に位置づける)
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await capture('承認画面 履歴セクション');

	// 2. 最古の承認待ちを承認 → 結果 (成功 or 赤 Alert)
	if (OLDEST_PENDING_ID) {
		const btn = page.getByTestId(`approve-btn-${OLDEST_PENDING_ID}`);
		if ((await btn.count()) > 0) {
			await btn.scrollIntoViewIfNeeded().catch(() => {});
			for (let i = 0; i < 5; i++) {
				await btn.click().catch(() => {});
				const settled = await page
					.waitForResponse((r) => /\?\/approveRedemption/.test(r.url()), { timeout: 5_000 })
					.then(() => true)
					.catch(() => false);
				if (settled) break;
			}
			await page.waitForLoadState('networkidle').catch(() => {});
		}
		await page.evaluate(() => window.scrollTo(0, 0));
		await capture('最古の承認待ちを承認した結果');
	}

	// 3. ポイント管理の変換りれき / 累計。
	// お子さまカードは hydration 後の $effect で自動選択されるため、選択済みを示す
	// 変換フォーム (お子さま名入り見出し) が出るまで待ってから撮る。
	await page.goto(`${BASE_URL}/admin/points`);
	await page
		.locator('h1, h2')
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 })
		.catch(() => {});
	await dismissOverlays(page);
	await page
		.getByText('のおこづかいにかえる')
		.first()
		.waitFor({ state: 'visible', timeout: 15_000 })
		.catch(() => {});
	// 変換りれきセクション (修正前は存在しない) が出るなら、それが見えるところまでスクロールする
	const historyCard = page.getByText('おこづかい変換りれき').first();
	if (await historyCard.isVisible().catch(() => false)) {
		await historyCard.scrollIntoViewIfNeeded().catch(() => {});
	} else {
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	}
	await capture('ポイント管理 変換りれきと累計');
};
