/**
 * scripts/capture-specs/flows/child-age-tone-4690.mjs (#4690)
 *
 * 子供画面の文体（ひらがな / 漢字）を年齢帯 × 画面の総当たりで撮る再利用可能な flow。
 * 年齢帯で文言を出し分ける変更は「1 画面だけ直って他が取り残される」形で壊れるため、
 * 撮る対象を env で足せる形にしておく（使い捨て script を増やさない、#1442）。
 *
 * env:
 *   CHILD_TONE_UI_MODES  撮る年齢帯（カンマ区切り、既定 `preschool,junior,senior`）
 *   CHILD_TONE_PAGES     子供ルート配下のパス（カンマ区切り、既定 `home,shop,status,challenges`）。
 *                        先頭が `/` の項目は `/{mode}/` を挟まずそのまま開く（`/checklist` のように
 *                        `[uiMode]` 配下に無い子供ルート用）
 *   CHILD_TONE_LOGIN_BONUS  `1` なら子供選択直後に出るログインボーナス (押印) 演出も撮る
 *                        （当日未受取の fixture でのみ開く。開かなければ warn して先へ進む）
 *   CHILD_TONE_STAMP_CARD   `1` ならヘッダーのスタンプカード dialog も開いて撮る
 *   CHILD_TONE_PREFIX    撮影ラベルの接頭辞（Before / After を撮り分けるとき `before-` / `after-`）
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
const CAPTURE_LOGIN_BONUS = process.env.CHILD_TONE_LOGIN_BONUS === '1';
const CAPTURE_STAMP_CARD = process.env.CHILD_TONE_STAMP_CARD === '1';
const PREFIX = process.env.CHILD_TONE_PREFIX ?? '';

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
 * 直前のページの document を捨ててから開く。
 *
 * dev server では同一 document 上で子供ページを続けて開くと hydrate に失敗して本文が
 * 消え、全白 PNG になる（SSR HTML は正しく、develop でも同じ挙動）。撮影側で毎回
 * まっさらな document から開いて避ける。
 */
async function freshGoto(page, url) {
	await page.goto('about:blank', { waitUntil: 'load' });
	await page.goto(url, { waitUntil: 'load' });
}

/**
 * `/switch` から対象の子供を選び、selectedChildId cookie を確立する。
 * これを踏まないと `/junior/home` 等は `/switch` に 302 される。
 */
async function selectChild(page, mode) {
	const childId = CHILD_ID_BY_UI_MODE[mode];
	if (!childId) return false;
	// `/switch` に `?screenshot=all` を付けると遷移オーバーレイが常時表示され click を奪うため付けない。
	for (let attempt = 0; attempt < 3; attempt += 1) {
		await freshGoto(page, `${BASE_URL}/switch`);
		await waitForStablePage(page);
		const selectBtn = page.getByTestId(`child-select-${childId}`);
		const ok = await selectBtn
			.waitFor({ state: 'visible', timeout: 20_000 })
			.then(() => true)
			.catch(() => false);
		if (!ok) continue;
		// 遷移中オーバーレイ (parent-gate-navigating) が click を intercept するため、消えるまで待つ
		await page
			.getByTestId('parent-gate-navigating')
			.waitFor({ state: 'hidden', timeout: 20_000 })
			.catch(() => {});
		await selectBtn.click();
		await page.waitForURL(new RegExp(`/${mode}/`), { timeout: 20_000 });
		return true;
	}
	throw new Error(`[child-age-tone-4690] /switch で ${mode} の子供カードが出ませんでした`);
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
		if (CAPTURE_LOGIN_BONUS) {
			// 子供選択直後の home で自動 claim → StampPressOverlay。points フェーズ (確定ボタン表示) まで待つ。
			// demo fixture で当日 claim 済の子供 (DEMO_LOGIN_STREAKS) は overlay が出ないので warn して先へ進む。
			const shown = await page
				.getByTestId('login-bonus-confirm')
				.waitFor({ state: 'visible', timeout: 20_000 })
				.then(() => true)
				.catch(() => false);
			if (shown) {
				await waitForStablePage(page);
				await capture(`${PREFIX}child-${mode}-login-bonus`);
			} else {
				console.warn(
					`[child-age-tone-4690] ${mode}: ログインボーナス演出が出ませんでした (claim 済 fixture?)`,
				);
			}
		}
		if (CAPTURE_STAMP_CARD) {
			// ヘッダーの「💮 n/5」からスタンプカード dialog を開く (年齢帯で文言が変わる)
			const trigger = page.getByTestId('header-stamp-btn');
			const shown = await trigger
				.waitFor({ state: 'visible', timeout: 20_000 })
				.then(() => true)
				.catch(() => false);
			if (shown) {
				await trigger.click();
				await page.getByTestId('stamp-card').waitFor({ state: 'visible', timeout: 20_000 });
				await waitForStablePage(page);
				await capture(`${PREFIX}child-${mode}-stamp-card`);
				await page.keyboard.press('Escape');
			} else {
				console.warn(
					`[child-age-tone-4690] ${mode}: スタンプカードのヘッダーボタンが出ませんでした`,
				);
			}
		}
		for (const path of PAGES) {
			// client-side router を経由せず、毎回まっさらな document から開く。
			const url = path.startsWith('/')
				? `${BASE_URL}${path}?screenshot=all`
				: `${BASE_URL}/${mode}/${path}?screenshot=all`;
			await freshGoto(page, url);
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
			await capture(`${PREFIX}child-${mode}-${path.replace(/^\//, '')}`);
		}
	}
};
