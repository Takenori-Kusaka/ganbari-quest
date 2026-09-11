/**
 * scripts/capture-specs/flows/admin-activities-per-child-scope-4692.mjs
 *
 * Issue #4692: 活動管理の ︙「すべて削除」確認文の before / after SS。
 *
 * 撮影する 1 コマ (どちらの build でも同じ操作列):
 *   2 人目の子タブを選択 → ︙ overflow menu → 「すべて削除」 → 確認行
 *     - 修正前 (origin/develop, SS_PHASE=before-*): 「本当に全削除しますか？」だけで、
 *       誰の何件が消えるのかが書かれていない (実際は tenant 全 child が消える)
 *     - 修正後 (本 PR, SS_PHASE=after-*): 「<選択中の子>の活動 N 件をすべて削除します
 *       （他のお子さまの活動は消えません）」
 *
 * 使用例 (demo 決定的環境で dev server を起動してから):
 *   MSYS_NO_PATHCONV=1 SS_PHASE=after BASE_URL=http://localhost:5173 \
 *     node scripts/capture.mjs \
 *     --flow clear-all-confirm \
 *     --url /admin/activities \
 *     --actions scripts/capture-specs/flows/admin-activities-per-child-scope-4692.mjs \
 *     --presets desktop --pr 4787
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PHASE = process.env.SS_PHASE || 'after';
const VIEWPORT = process.env.SS_VIEWPORT || 'desktop';

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

	await page.goto(`${BASE_URL}/admin/activities`, { waitUntil: 'domcontentloaded' });

	// hydration gate: 子供タブは client mount 後に click ハンドラが付く。
	const tabs = page.locator('[data-testid^="child-tab-"]');
	await tabs.first().waitFor({ state: 'visible', timeout: 60_000 });

	// hydration gate: Ark UI menu は mount 時に data-state を付ける。これが出るまでは
	// tab click も menu open も無反応なので、先に待つ (dev server の初回コンパイルは十数秒)。
	await page
		.locator('[data-testid="header-overflow-menu-btn"][data-state]')
		.waitFor({ state: 'visible', timeout: 90_000 });

	// 「最初の子ではない子」を選ぶ (対象範囲の違いが可視化される)。
	const tabCount = await tabs.count();
	if (tabCount >= 2) {
		const second = tabs.nth(1);
		for (let attempt = 0; attempt < 20; attempt++) {
			await second.click().catch(() => {});
			if ((await second.getAttribute('aria-selected')) === 'true') break;
			await rafSettle();
		}
		await rafSettle();
	}

	// ︙ overflow menu → すべて削除
	const overflow = page.getByTestId('header-overflow-menu-btn');
	await overflow.waitFor({ state: 'visible', timeout: 30_000 });
	const clearAll = page.getByTestId('menu-item-clear-all');
	// dev server の初回コンパイルは十数秒かかるため、hydration が終わるまで retry する
	// (menu は client mount 後にしか開かない)。
	// `isVisible()` は即時判定 (待たない) なので、可視待ちは waitFor で行う。
	// 即時判定で false → 再 click すると menu をトグルで閉じてしまい永久に開かない。
	for (let attempt = 0; attempt < 10; attempt++) {
		await overflow.click().catch(() => {});
		const opened = await clearAll
			.waitFor({ state: 'visible', timeout: 3_000 })
			.then(() => true)
			.catch(() => false);
		if (opened) break;
		await rafSettle();
	}
	await clearAll.waitFor({ state: 'visible', timeout: 30_000 });
	await clearAll.click();

	// 確認行が出るまで待つ (修正後は testid 付き、修正前はテキストのみ)。
	const scopedConfirm = page.getByTestId('clear-all-confirm-text');
	const legacyConfirm = page.getByText('本当に全削除しますか？');
	await Promise.race([
		scopedConfirm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
		legacyConfirm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
	]);

	// 修正後 build なのに scoped 確認文が出ていないなら、旧文言を「修正後」として貼ることになる。
	// 握りつぶさず throw して撮影自体を失敗させる (SS 捏造の構造的防止)。
	if (PHASE.startsWith('after') && (await scopedConfirm.count()) === 0) {
		throw new Error(
			'[flow] 修正後 build なのに clear-all-confirm-text が DOM に無い。撮影を中止する。',
		);
	}

	await rafSettle();
	await capture(`${PHASE}-clear-all-confirm-${VIEWPORT}`);
};
