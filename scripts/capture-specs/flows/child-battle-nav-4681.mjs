/**
 * scripts/capture-specs/flows/child-battle-nav-4681.mjs (#4681)
 *
 * 子供画面のバトル導線 (CharacterTabs「バトル」タブ) と、バトル結果後のヘッダー残高反映を撮る。
 * AUTH_MODE=local (npm run dev / preview) で動作。
 *
 * 環境変数:
 *   SS_PREFIX  before / after (Before/After ペアリング用。ステップ名の先頭に付く)
 *   SS_PRESET  mobile / desktop (ステップ名末尾に付く)
 *   SS_CHILD   選択する子供の nickname (既定: けんたくん = elementary)
 *   SS_MODE    uiMode (既定: elementary)
 *
 * 使用例:
 *   SS_PREFIX=after SS_PRESET=mobile node scripts/capture.mjs --pr <N> \
 *     --flow after-battle-nav-mobile --url /switch \
 *     --actions scripts/capture-specs/flows/child-battle-nav-4681.mjs --presets mobile
 */

const prefix = process.env.SS_PREFIX ?? 'after';
const preset = process.env.SS_PRESET ?? 'desktop';
const childName = process.env.SS_CHILD ?? 'けんたくん';
const mode = process.env.SS_MODE ?? 'elementary';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.context().clearCookies();
	// FlowRecorder は baseURL を context に設定しないため、recorder が開いた絶対 URL を基準に解決する
	const origin = new URL(page.url()).origin;
	const go = (path) => page.goto(new URL(path, origin).toString());

	await go('/switch');
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: childName }).click();
	await page.waitForURL(new RegExp(`/${mode}/home`));

	// つよさ (status) — CharacterTabs にバトルタブが並ぶ (after) / 並ばない (before)
	await go(`/${mode}/status`);
	await page.locator('[data-testid="character-tabs"]').waitFor({ state: 'visible' });
	await capture(`${prefix}-status-tabs-${mode}-${preset}`);

	// バトル画面 (before は URL 直打ちでしか来られない)
	await go(`/${mode}/battle`);
	await page.locator('[data-testid="battle-page"]').waitFor({ state: 'visible' });
	await capture(`${prefix}-battle-page-${mode}-${preset}`);
};
