// tests/unit/tutorial/page-guide-active-element-4922.test.ts
// #4922: ページガイドを進めると前の step の `.driver-active-element` クラスが外れず、
// 複数の要素が同時に光ったままになる回帰の固定テスト。
//
// 本番実測 (/admin/subscription 3/6 で 3 要素、/admin/status で 8 step 中最大 7 要素) を
// 「複数要素に同時に `.driver-active-element` が付いている」状態として再現する。driver.js の
// 内部状態 (`__activeElement`) は highlight アニメーション (既定 400ms) 完了時にのみ更新される
// ため、400ms 以内に次の step へ進む (通常のクリック速度で普通に起こる) と直前対象のクラス
// 除去が永久にスキップされる。実 driver.js を使い、gap 0ms (完全同期連打、最も過酷な race) でも
// `clearStaleActiveElementClasses` を `onHighlightStarted` に配線すれば
// 常に `.driver-active-element` が 1 件に保たれることを検証する。

import { driver } from 'driver.js';
import { afterEach, describe, expect, it } from 'vitest';
import { clearStaleActiveElementClasses } from '$lib/ui/tutorial/page-guide-active-element';

/** テスト対象要素に非 0 の bounding box を持たせる (jsdom は既定で全要素 0×0 を返すため)。 */
function stubVisibleRect(el: HTMLElement): void {
	el.getBoundingClientRect = () =>
		({
			x: 0,
			y: 0,
			width: 100,
			height: 50,
			top: 0,
			left: 0,
			right: 100,
			bottom: 50,
			toJSON: () => ({}),
		}) as DOMRect;
}

describe('clearStaleActiveElementClasses (#4922)', () => {
	let driverInstance: ReturnType<typeof driver> | null = null;

	afterEach(() => {
		driverInstance?.destroy();
		driverInstance = null;
		document.body.innerHTML = '';
	});

	/** PageGuideOverlay.svelte の startDriver 設定を最小再現する (onHighlightStarted 配線が要点)。 */
	function buildDriver(ids: string[], opts: { withFix: boolean }) {
		return driver({
			animate: true,
			smoothScroll: false,
			allowClose: true,
			overlayClickBehavior: () => {},
			stagePadding: 8,
			stageRadius: 12,
			overlayColor: 'rgb(0, 0, 0)',
			overlayOpacity: 0.6,
			disableActiveInteraction: false,
			allowKeyboardControl: true,
			steps: ids.map((id) => ({
				element: () => document.getElementById(id) as Element,
				popover: { title: id },
			})),
			...(opts.withFix
				? {
						onHighlightStarted: (element) => {
							clearStaleActiveElementClasses(element ?? null);
						},
					}
				: {}),
		});
	}

	function activeElementIds(): string[] {
		return [...document.querySelectorAll('.driver-active-element')].map((el) => el.id);
	}

	it('gap 0ms (完全同期連打) でも fix 配線ありなら常に active element が 1 件', () => {
		document.body.innerHTML = '<div id="a"></div><div id="b"></div><div id="c"></div>';
		for (const id of ['a', 'b', 'c']) stubVisibleRect(document.getElementById(id) as HTMLElement);

		driverInstance = buildDriver(['a', 'b', 'c'], { withFix: true });
		driverInstance.drive(0);
		expect(activeElementIds(), 'step1 直後').toEqual(['a']);

		// 400ms の highlight アニメーション完了を待たず、同一 tick で step を連打する (最悪ケース)。
		driverInstance.moveNext();
		expect(activeElementIds(), 'step1→2 を同期連打した直後 (fix なしなら a が残留する)').toEqual([
			'b',
		]);

		driverInstance.moveNext();
		expect(activeElementIds(), 'step2→3 を同期連打した直後 (fix なしなら a, b が残留する)').toEqual(
			['c'],
		);
	});

	it('fix 配線なし (回帰再現): 同期連打すると前 step の class が残留し複数要素が同時に光る', () => {
		document.body.innerHTML = '<div id="a"></div><div id="b"></div><div id="c"></div>';
		for (const id of ['a', 'b', 'c']) stubVisibleRect(document.getElementById(id) as HTMLElement);

		driverInstance = buildDriver(['a', 'b', 'c'], { withFix: false });
		driverInstance.drive(0);
		expect(activeElementIds()).toEqual(['a']);

		driverInstance.moveNext();
		driverInstance.moveNext();

		// driver.js 自身の内部タイミング (アニメーション完了待ち) に起因する既知の挙動:
		// 前 2 step (a, b) の class が外れないまま c が追加され、3 要素が同時に光る
		// (本番実測 /admin/subscription 3/6 で 3 要素、/admin/status で最大 7 要素と同型)。
		expect(activeElementIds()).toEqual(['a', 'b', 'c']);
	});

	it('段階的にクリック間隔を空けても (400ms 未満) fix なしでは残留が蓄積する', async () => {
		document.body.innerHTML =
			'<div id="a"></div><div id="b"></div><div id="c"></div><div id="d"></div>';
		for (const id of ['a', 'b', 'c', 'd']) {
			stubVisibleRect(document.getElementById(id) as HTMLElement);
		}

		driverInstance = buildDriver(['a', 'b', 'c', 'd'], { withFix: false });
		driverInstance.drive(0);

		const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
		// 100ms 間隔 (400ms の highlight アニメーションより短い、現実的な素早いクリック速度) で連打。
		await sleep(100);
		driverInstance.moveNext();
		await sleep(100);
		driverInstance.moveNext();
		await sleep(100);
		driverInstance.moveNext();
		await sleep(100);

		// step を進めるほど枠線付きの要素が増える (#4922 本文の実測描写と同型)。
		expect(activeElementIds().length, '4 step 進めて a〜d が全て残留する').toBeGreaterThan(1);
	});

	it('段階的にクリック間隔を空けても fix ありなら常に active element が 1 件のまま', async () => {
		document.body.innerHTML =
			'<div id="a"></div><div id="b"></div><div id="c"></div><div id="d"></div>';
		for (const id of ['a', 'b', 'c', 'd']) {
			stubVisibleRect(document.getElementById(id) as HTMLElement);
		}

		driverInstance = buildDriver(['a', 'b', 'c', 'd'], { withFix: true });
		driverInstance.drive(0);

		const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
		await sleep(100);
		driverInstance.moveNext();
		expect(activeElementIds()).toEqual(['b']);
		await sleep(100);
		driverInstance.moveNext();
		expect(activeElementIds()).toEqual(['c']);
		await sleep(100);
		driverInstance.moveNext();
		expect(activeElementIds()).toEqual(['d']);
	});

	it('中央 modal (selector 省略) step へ遷移すると前 step の class も除去される', () => {
		document.body.innerHTML = '<div id="a"></div>';
		stubVisibleRect(document.getElementById('a') as HTMLElement);

		driverInstance = driver({
			animate: true,
			steps: [
				{ element: () => document.getElementById('a') as Element, popover: { title: 'a' } },
				// selector 省略 step (概要 modal 相当) — driver.js が #driver-dummy-element を挿入する
				{ popover: { title: 'center' } },
			],
			onHighlightStarted: (element) => {
				clearStaleActiveElementClasses(element ?? null);
			},
		});
		driverInstance.drive(0);
		expect(activeElementIds()).toEqual(['a']);

		driverInstance.moveNext();
		// dummy element (id=driver-dummy-element) だけが active。'a' は残らない。
		expect(activeElementIds()).toEqual(['driver-dummy-element']);
	});
});
