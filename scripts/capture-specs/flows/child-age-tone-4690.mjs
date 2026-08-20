/**
 * scripts/capture-specs/flows/child-age-tone-4690.mjs (#4690)
 *
 * 子供画面の文体（ひらがな / 漢字）を年齢帯 × 画面の総当たりで撮る再利用可能な flow。
 * 年齢帯で文言を出し分ける変更は「1 画面だけ直って他が取り残される」形で壊れるため、
 * 撮る対象を env で足せる形にしておく（使い捨て script を増やさない、#1442）。
 *
 * env:
 *   CHILD_TONE_UI_MODES  撮る年齢帯（カンマ区切り、既定 `preschool,junior,senior`）
 *   CHILD_TONE_PAGES     子供ルート配下のパス（カンマ区切り、既定 `home,shop,status,challenges`）
 *
 * 使用例 (BASE_URL は AUTH_MODE=anonymous DATA_SOURCE=demo で起動した dev server):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5190 node scripts/capture.mjs \
 *     --flow child-age-tone-4690 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-age-tone-4690.mjs \
 *     --presets mobile \
 *     --max-steps 20 \
 *     --out <出力先>
 */

import { waitForStablePage } from '../../lib/ci/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const UI_MODES = (process.env.CHILD_TONE_UI_MODES || 'preschool,junior,senior').split(',');
const PAGES = (process.env.CHILD_TONE_PAGES || 'home,shop,status,challenges').split(',');

/** demo fixture の uiMode → childId（`scripts/capture-hp-screenshots.mjs` と同じ対応表）。 */
const CHILD_ID_BY_UI_MODE = {
	baby: '901',
	preschool: '902',
	elementary: '903',
	junior: '904',
	senior: '905',
};

/**
 * `/switch` から対象の子供を選び、selectedChildId cookie を確立する。
 * これを踏まないと `/junior/home` 等は `/switch` に 302 される。
 */
async function selectChild(page, mode) {
	const childId = CHILD_ID_BY_UI_MODE[mode];
	if (!childId) return false;
	// `/switch` に `?screenshot=all` を付けると遷移オーバーレイが常時表示され click を奪うため付けない。
	await page.goto(`${BASE_URL}/switch`, { waitUntil: 'domcontentloaded' });
	await waitForStablePage(page);
	const selectBtn = page.getByTestId(`child-select-${childId}`);
	await selectBtn.waitFor({ state: 'visible', timeout: 20_000 });
	await page
		.getByTestId('parent-gate-navigating')
		.waitFor({ state: 'hidden', timeout: 20_000 })
		.catch(() => {});
	await selectBtn.click();
	await page.waitForURL(new RegExp(`/${mode}/`), { timeout: 20_000 });
	return true;
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const mode of UI_MODES) {
		if (!(await selectChild(page, mode))) {
			console.warn(`[child-age-tone-4690] unknown uiMode: ${mode}`);
			continue;
		}
		for (const path of PAGES) {
			// client-side router を経由せず full load で開き直す (dev server の module graph 依存を避ける)。
			await page.goto(`${BASE_URL}/${mode}/${path}?screenshot=all`, { waitUntil: 'load' });
			// 本文が入るまで待つ。`main` の可視化だけでは skeleton の瞬間を撮って全白 PNG になる。
			await page.waitForFunction(
				() => {
					const main = document.querySelector('main, [role="main"]');
					return !!main && (main.textContent ?? '').trim().length > 20;
				},
				undefined,
				{ timeout: 20_000 },
			);
			await waitForStablePage(page);
			await capture(`child-${mode}-${path}`);
		}
	}
};
