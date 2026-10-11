// tests/unit/ui/budoux-action.test.ts (#4964)
// `use:budoux` (docs/DESIGN.md §3) — auto-phrase 非対応ブラウザで BudouX の文節境界に ゼロ幅スペース を差し込み、
// Svelte が text node を書き換えても壊れない (重複しない) こと。

import { render } from '@testing-library/svelte';
import { jaModel, Parser } from 'budoux';
import { describe, expect, it, vi } from 'vitest';
import {
	BUDOUX_APPLIED_ATTR,
	BUDOUX_ATTR,
	createBudouxAction,
	type Segmenter,
} from '../../../src/lib/ui/actions/budoux';
import PageGuideTabs from '../../../src/lib/ui/tutorial/PageGuideTabs.svelte';
import type { GuideStep } from '../../../src/lib/ui/tutorial/page-guide-types';

/** ゼロ幅スペース (U+200B)。見えない文字をソースに直接書かない */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const parser = new Parser(jaModel);
const realSegmenter: Segmenter = (text) => parser.parse(text);

function mount(text: string, deps: Parameters<typeof createBudouxAction>[0]) {
	const el = document.createElement('p');
	el.textContent = text;
	document.body.append(el);
	const handle = createBudouxAction(deps)(el);
	return { el, destroy: () => (handle ? handle.destroy?.() : undefined) };
}

/** action の遅延読込 (promise) と MutationObserver のコールバックを流す。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('use:budoux (#4964)', () => {
	it('auto-phrase を解釈するブラウザでは BudouX を読み込まず、CSS 用の属性だけ付ける', async () => {
		const loadSegmenter = vi.fn(async () => realSegmenter);
		const { el } = mount('今日はいい天気です', { supportsAutoPhrase: () => true, loadSegmenter });
		await flush();

		expect(loadSegmenter).not.toHaveBeenCalled();
		expect(el.hasAttribute(BUDOUX_ATTR)).toBe(true);
		expect(el.hasAttribute(BUDOUX_APPLIED_ATTR)).toBe(false);
		expect(el.textContent).not.toContain(ZERO_WIDTH_SPACE);
	});

	it('解釈しないブラウザでは文節の境界に ZERO_WIDTH_SPACE を差し込み、text node を分割しない', async () => {
		const text = 'ごほうびをこうかんするときは、おやカギコードをいれてください';
		const { el } = mount(text, {
			supportsAutoPhrase: () => false,
			loadSegmenter: async () => realSegmenter,
		});
		const original = el.firstChild;
		await flush();

		expect(el.hasAttribute(BUDOUX_APPLIED_ATTR)).toBe(true);
		expect(el.childNodes).toHaveLength(1);
		expect(el.firstChild).toBe(original);
		expect(el.textContent).toBe(realSegmenter(text).join(ZERO_WIDTH_SPACE));
		expect(el.textContent?.split(ZERO_WIDTH_SPACE).length).toBeGreaterThan(1);
		expect(el.textContent?.replaceAll(ZERO_WIDTH_SPACE, '')).toBe(text);
	});

	it('text node の値が書き換えられたら差し込み直し、古い文を残さない', async () => {
		const { el } = mount('はじめてのかたへ', {
			supportsAutoPhrase: () => false,
			loadSegmenter: async () => realSegmenter,
		});
		await flush();
		const node = el.firstChild as Text;

		node.nodeValue = '活動を記録するとポイントがたまります';
		await flush();

		expect(el.childNodes).toHaveLength(1);
		expect(el.textContent?.replaceAll(ZERO_WIDTH_SPACE, '')).toBe(
			'活動を記録するとポイントがたまります',
		);
		expect(el.textContent).toContain(ZERO_WIDTH_SPACE);
	});

	it('日本語を含まない文字列は書き換えない', async () => {
		const { el } = mount('Step 1 / 5', {
			supportsAutoPhrase: () => false,
			loadSegmenter: async () => realSegmenter,
		});
		await flush();
		expect(el.textContent).toBe('Step 1 / 5');
	});

	it('読込が終わる前に破棄されたら何もしない', async () => {
		let resolve: (s: Segmenter) => void = () => {};
		const { el, destroy } = mount('今日はいい天気です', {
			supportsAutoPhrase: () => false,
			loadSegmenter: () => new Promise<Segmenter>((r) => (resolve = r)),
		});
		destroy();
		resolve(realSegmenter);
		await flush();
		expect(el.hasAttribute(BUDOUX_APPLIED_ATTR)).toBe(false);
		expect(el.textContent).toBe('今日はいい天気です');
	});

	it('BudouX の読込に失敗しても文字を欠かさず、通常の折り返しのまま表示する', async () => {
		const { el } = mount('今日はいい天気です', {
			supportsAutoPhrase: () => false,
			loadSegmenter: () => Promise.reject(new Error('network')),
		});
		await flush();
		expect(el.textContent).toBe('今日はいい天気です');
		expect(el.hasAttribute(BUDOUX_APPLIED_ATTR)).toBe(false);
	});
});

describe('use:budoux を付けた component の step 切替 (#4964)', () => {
	const step = (id: string, what: string): GuideStep =>
		({ id, title: id, what, how: '操作のしかた', goal: 'できること' }) as GuideStep;

	it('Svelte が本文を差し替えても、前の step の文が残らず ZERO_WIDTH_SPACE が入り直す', async () => {
		// jsdom の CSS.supports は何を渡しても true を返すため、非対応ブラウザ (Safari) の経路に倒す
		const supports = vi.spyOn(CSS, 'supports').mockReturnValue(false);
		const first = 'このページでは、お子さまの活動を記録します';
		const second = 'ごほうびは、ためたポイントでこうかんできます';
		const { container, rerender } = render(PageGuideTabs, { props: { step: step('a', first) } });
		const content = () => container.querySelector('.guide-tab-content p');

		await vi.waitFor(() => expect(content()?.textContent).toContain(ZERO_WIDTH_SPACE), {
			timeout: 5_000,
		});
		expect(content()?.textContent?.replaceAll(ZERO_WIDTH_SPACE, '')).toBe(first);

		await rerender({ step: step('b', second) });
		await vi.waitFor(() => {
			expect(content()?.textContent?.replaceAll(ZERO_WIDTH_SPACE, '')).toBe(second);
			expect(content()?.textContent).toContain(ZERO_WIDTH_SPACE);
		});
		supports.mockRestore();
	});
});
