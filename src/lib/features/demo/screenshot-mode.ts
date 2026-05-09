// #1209: demo 配下の `?screenshot=1` 判定を layout/page 間で共有する context helper。
// layout で `setScreenshotModeContext(() => isScreenshotMode)` を呼び、各 page/component で
// `getScreenshotMode()` を呼ぶだけで同じ値を参照できる。page 側で `$page` store を再度
// import して再導出するのを避けるための SSOT。
//
// 禁止事項:
//  - props drilling（layout → page → component の引き回し）
//  - global `$state` 化（demo 外でも値が漏れる）
//  - 個別 page で `$page.url.searchParams.get('screenshot')` を呼ぶこと
//
// #1893 (PO-4-7、8 回目指摘): screenshot mode の `mode` 区分を追加。
//   - 'noise-only' (default, 後方互換): demo 固有の販促 UI のみ非表示。本番 UI は
//     現状維持（バナー / プラン切替トグル / DemoGuideBar / floating CTA を hide）。
//   - 'all': 'noise-only' に加え、本番 UI でも「screenshot 用に強制表示すべき要素」
//     (MilestoneBanner / TutorialOverlay 等) を強制 ON にする。LP 配信 SS が本番 NUC
//     と一致するよう要素を強制レンダリングする。`?screenshot=all` で有効化。
//
// `?screenshot=1` (= 'noise-only') は後方互換のため現状動作を維持する。`?screenshot=all`
// で本番一致モードに切り替わる。

import { getContext, setContext } from 'svelte';

const SCREENSHOT_MODE_KEY = Symbol('demo.screenshotMode');

/** screenshot mode の段階 (#1893)。
 * - 'off': screenshot mode 非有効（通常デモ）
 * - 'noise-only': demo 固有 UI 非表示 (後方互換、`?screenshot=1` 相当)
 * - 'all': 'noise-only' + 本番一致演出強制 (`?screenshot=all` 相当)
 */
export type ScreenshotMode = 'off' | 'noise-only' | 'all';

type ScreenshotModeGetter = () => boolean;
type ScreenshotModeKindGetter = () => ScreenshotMode;

interface ScreenshotModeContext {
	getActive: ScreenshotModeGetter;
	getMode: ScreenshotModeKindGetter;
}

/**
 * URL searchParams の `screenshot` 値から ScreenshotMode を解決する。
 * - `?screenshot=all` → 'all'
 * - `?screenshot=1` → 'noise-only' (後方互換)
 * - その他 → 'off'
 */
export function resolveScreenshotMode(rawValue: string | null): ScreenshotMode {
	if (rawValue === 'all') return 'all';
	if (rawValue === '1') return 'noise-only';
	return 'off';
}

/** layout で `$derived` の値を getter 経由で公開する。getter 経由で渡すことで Runes のリアクティビティを保つ。
 *
 * @param getter screenshot mode が active (= 'noise-only' | 'all') かを返す getter (後方互換)
 * @param modeGetter screenshot mode の段階 (#1893) を返す getter (省略時は active から推定)
 */
export function setScreenshotModeContext(
	getter: ScreenshotModeGetter,
	modeGetter?: ScreenshotModeKindGetter,
): void {
	const ctx: ScreenshotModeContext = {
		getActive: getter,
		// 後方互換: modeGetter 省略時は active=true → 'noise-only' (旧挙動)
		getMode: modeGetter ?? (() => (getter() ? 'noise-only' : 'off')),
	};
	setContext(SCREENSHOT_MODE_KEY, ctx);
}

/**
 * page / component で現在の screenshot mode が active (= 'noise-only' | 'all') かを取得する。
 * demo layout の外で呼ばれたとき（予期せぬ利用）は `false` を返す。
 *
 * 後方互換のため boolean を返す。段階を区別したい場合は `getScreenshotModeKind()` を使う。
 */
export function getScreenshotMode(): boolean {
	const ctx = getContext<ScreenshotModeContext | undefined>(SCREENSHOT_MODE_KEY);
	return ctx ? ctx.getActive() : false;
}

/**
 * #1893: 現在の screenshot mode 段階を取得する。
 * - 'off': screenshot mode 非有効
 * - 'noise-only': `?screenshot=1` (demo 固有 UI 非表示のみ)
 * - 'all': `?screenshot=all` (本番一致演出強制 ON)
 *
 * demo layout の外で呼ばれたときは 'off' を返す。
 */
export function getScreenshotModeKind(): ScreenshotMode {
	const ctx = getContext<ScreenshotModeContext | undefined>(SCREENSHOT_MODE_KEY);
	return ctx ? ctx.getMode() : 'off';
}
