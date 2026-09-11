/**
 * scripts/capture-specs/flows/child-nav-labels-4715.mjs (#4715)
 *
 * 子供画面の下部ナビ（BottomNav）のラベルを年齢帯ごとに撮る再利用可能な flow。
 * `/junior/home` 等は `selectedChildId` cookie が無いと `/switch` に 302 されるため、
 * `/switch` から対象の子供を選んで着地してから撮る。
 *
 * 撮影する年齢帯は env `CHILD_NAV_UI_MODES`（カンマ区切り、既定 `junior,preschool`）で指定する。
 *
 * 使用例 (BASE_URL は AUTH_MODE=anonymous DATA_SOURCE=demo で起動した dev server):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5190 node scripts/capture.mjs \
 *     --flow child-nav-labels-4715 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-nav-labels-4715.mjs \
 *     --presets mobile \
 *     --out tmp/screenshots/pr-XXXX/
 */

import { waitForStablePage } from '../../lib/ci/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const UI_MODES = (process.env.CHILD_NAV_UI_MODES || 'junior,preschool').split(',');

/** demo fixture の uiMode → childId（`scripts/capture-hp-screenshots.mjs` と同じ対応表）。 */
const CHILD_ID_BY_UI_MODE = {
	baby: '901',
	preschool: '902',
	elementary: '903',
	junior: '904',
	// #4690: demo fixture に 905 は無い (senior = 906)。905 だと /switch でカードが見つからない。
	senior: '906',
};

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const mode of UI_MODES) {
		const childId = CHILD_ID_BY_UI_MODE[mode];
		if (!childId) {
			console.warn(`[child-nav-labels-4715] unknown uiMode: ${mode}`);
			continue;
		}
		// `/switch` の子供カードは `<form method="POST" action="?/select">` の submit ボタン。
		// これを押して selectedChildId を確立してから子供ホームへ着地する。
		// `/switch` は `?screenshot=all` を付けると LP 用に遷移オーバーレイを常時表示するため、
		// 選択操作のときは付けない (撮影する子供ホーム側にだけ付ける)。
		await page.goto(`${BASE_URL}/switch`, { waitUntil: 'domcontentloaded' });
		await waitForStablePage(page);
		const selectBtn = page.getByTestId(`child-select-${childId}`);
		await selectBtn.waitFor({ state: 'visible', timeout: 20_000 });
		// 遷移中オーバーレイ (parent-gate-navigating) が click を intercept するため、消えるまで待つ
		await page
			.getByTestId('parent-gate-navigating')
			.waitFor({ state: 'hidden', timeout: 20_000 })
			.catch(() => {});
		await selectBtn.click();
		await page.waitForURL(new RegExp(`/${mode}/`), { timeout: 20_000 });
		// 撮影は `?screenshot=all` 付きで行う (demo 固有 UI を落とし本番一致の演出にする)。
		// client-side router を経由せず full load で開き直す (dev server の module graph 依存を避ける)。
		await page.goto(`${BASE_URL}/${mode}/home?screenshot=all`, { waitUntil: 'load' });
		await waitForStablePage(page);
		await capture(`child-nav-${mode}`);
	}
};
