// tests/unit/routes/admin-status-benchmark-age-4914.test.ts
//
// #4914: `/admin/status` のベンチマーク年齢選択が `let benchmarkAge = $state(4);` の固定値で、
// 選択中の子供の実年齢 (例: 8歳) と食い違っていた。保護者は「4歳のベンチマークが未設定です」
// という警告を、8歳の子について読まされる状態になっていた。
//
// 固定する不変条件:
//   [A] 初期選択が選択中の子供の年齢になる（旧実装は常に 4 固定）
//   [B] ベンチマーク表の対応範囲 (3〜12歳) 外の子供は最寄りの端に丸める
//   [C] 子供タブを切り替えると benchmarkAge も追従する
//
// `+page.svelte` は `RadarChart.svelte` を静的 import しており、`svelte/motion` の
// `export const prefersReducedMotion = new MediaQuery(...)` が **import 評価時点**
// (component mount 前) に `window.matchMedia` を呼ぶ。jsdom は `matchMedia` を実装しないため
// (`tests/unit/ui/RadarChart.test.ts` 冒頭コメントに既知の制約として記載あり)、
// 静的 import では module graph 評価時に必ず落ちる。`window.matchMedia` を polyfill してから
// 動的 import することで、この 1 file に限定して回避する（グローバル設定は変更しない）。
if (typeof window.matchMedia !== 'function') {
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia;
}

import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} }),
}));
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(async () => {}),
}));

import { CATEGORY_DEFS } from '../../../src/lib/domain/validation/activity';

type StatusChild = {
	id: number;
	nickname: string;
	age: number;
	status: null;
	monthlyComparison: null;
	benchmarkValues: unknown[];
};

type StatusProps = {
	children: StatusChild[];
	categoryDefs: typeof CATEGORY_DEFS;
	benchmarks: unknown[];
	levelTitles: unknown[];
	canEditBenchmark: boolean;
};

let StatusPage: Component<{ data: StatusProps }>;

beforeAll(async () => {
	// polyfill 適用後に動的 import することで RadarChart / svelte/motion の module graph 評価を
	// polyfill 済みの状態にする (静的 import は先頭の polyfill より前に評価されてしまうため不可)。
	const mod = await import('../../../src/routes/(parent)/admin/status/+page.svelte');
	StatusPage = mod.default as unknown as Component<{ data: StatusProps }>;
});

function makeChild(overrides: Partial<StatusChild> = {}): StatusChild {
	return {
		id: 1,
		nickname: 'てすとくん',
		age: 8,
		status: null,
		monthlyComparison: null,
		benchmarkValues: [],
		...overrides,
	};
}

function makeData(overrides: Partial<StatusProps> = {}): StatusProps {
	return {
		children: [makeChild()],
		categoryDefs: CATEGORY_DEFS,
		benchmarks: [],
		levelTitles: [],
		canEditBenchmark: true,
		...overrides,
	};
}

afterEach(() => cleanup());

describe('#4914 /admin/status ベンチマーク年齢の初期選択', () => {
	it('[A] 選択中の子供 (8歳) の年齢で初期化される（旧実装は常に4歳固定）', () => {
		const { getByTestId } = render(StatusPage, { props: { data: makeData() } });
		expect(getByTestId('benchmark-guide').textContent).toContain('8歳の目安');
	});

	it('[B] 3〜12歳の範囲外 (2歳) は最寄りの下限 (3歳) に丸める', () => {
		const { getByTestId } = render(StatusPage, {
			props: { data: makeData({ children: [makeChild({ age: 2 })] }) },
		});
		expect(getByTestId('benchmark-guide').textContent).toContain('3歳の目安');
	});

	it('[B] 3〜12歳の範囲外 (15歳) は最寄りの上限 (12歳) に丸める', () => {
		const { getByTestId } = render(StatusPage, {
			props: { data: makeData({ children: [makeChild({ age: 15 })] }) },
		});
		expect(getByTestId('benchmark-guide').textContent).toContain('12歳の目安');
	});

	it('[C] 子供タブを切り替えると benchmarkAge も追従する', async () => {
		const child1 = makeChild({ id: 1, nickname: 'たろう', age: 8 });
		const child2 = makeChild({ id: 2, nickname: 'はなこ', age: 5 });
		const { getByTestId } = render(StatusPage, {
			props: { data: makeData({ children: [child1, child2] }) },
		});
		expect(getByTestId('benchmark-guide').textContent).toContain('8歳の目安');

		await fireEvent.click(getByTestId('status-child-tab-2'));

		expect(getByTestId('benchmark-guide').textContent).toContain('5歳の目安');
	});
});
