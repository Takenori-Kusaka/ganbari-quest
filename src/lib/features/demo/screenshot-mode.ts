// #1209: demo 配下の `?screenshot=1` 判定を layout/page 間で共有する context helper。
// layout で `setScreenshotModeContext(() => isScreenshotMode)` を呼び、各 page/component で
// `getScreenshotMode()` を呼ぶだけで同じ値を参照できる。page 側で `$page` store を再度
// import して再導出するのを避けるための SSOT。
//
// 禁止事項:
//  - props drilling（layout → page → component の引き回し）
//  - global `$state` 化（demo 外でも値が漏れる）
//  - 個別 page で `$page.url.searchParams.get('screenshot')` を呼ぶこと

import { getContext, setContext } from 'svelte';

const SCREENSHOT_MODE_KEY = Symbol('demo.screenshotMode');

type ScreenshotModeGetter = () => boolean;

/** layout で `$derived` の値を getter 経由で公開する。getter 経由で渡すことで Runes のリアクティビティを保つ。 */
export function setScreenshotModeContext(getter: ScreenshotModeGetter): void {
	setContext(SCREENSHOT_MODE_KEY, getter);
}

/**
 * page / component で現在の screenshot mode を取得する。
 * demo layout の外で呼ばれたとき（予期せぬ利用）は `false` を返す。
 */
export function getScreenshotMode(): boolean {
	const getter = getContext<ScreenshotModeGetter | undefined>(SCREENSHOT_MODE_KEY);
	return getter ? getter() : false;
}
