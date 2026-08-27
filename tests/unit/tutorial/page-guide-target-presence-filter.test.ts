// tests/unit/tutorial/page-guide-target-presence-filter.test.ts
// #4653 (EPIC #4650 PO 判断 4): filterGuideStepsByTargetPresence / isGuideTargetRendered の回帰ガード
// と、/admin ホームガイドの「条件付き step が描画時だけ出る」宣言の固定。
//
// ガイド step の selector が「条件付き UI (承認待ちバナー / 今月のがんばり / お子さま 0 人で出ない
// 子供タブ) / viewport 別 nav (desktop: header 下 / mobile: 画面下部)」を指すとき、対象が描画されて
// いない step をそのまま driver.js に渡すと中央 dummy (0×0) か display:none 要素の 0×0 spotlight に
// なる (/admin desktop step 3 の実害)。AdminLayout は起動直前に 2 段で絞る:
//   1. `filterGuideStepsByPresence` (#4668 / #4677、汎用挙動は page-guide-runtime-filter.test.ts)
//      — `optional: true` かつ selector 付きの step を、対象が可視でなければ落とす
//   2. `filterGuideStepsByTargetPresence` (#4653) — selector 付き step を、対象が未描画なら落とす
//      - selector 省略 step (中央 modal の概要) は常に残る
//      - 判定は driver.js と同じ「最初の一致要素」基準 (後続に可視要素があっても最初が非表示なら除外)
//      - 残 0 なら null (既存 3 フィルタと同型)

import { describe, expect, it } from 'vitest';
import {
	filterGuideStepsByPresence,
	filterGuideStepsByTargetPresence,
	isGuideTargetRendered,
} from '../../../src/lib/ui/tutorial/page-guide-registry';
import type { PageGuide } from '../../../src/lib/ui/tutorial/page-guide-types';
import { ADMIN_HOME_GUIDE } from '../../../src/routes/(parent)/admin/_guide';

const fixture: PageGuide = {
	pageId: 'test-page',
	title: 'テスト',
	icon: '🧪',
	steps: [
		{ id: 'intro', title: '概要', what: 'a', how: 'b', goal: 'c' },
		{
			id: 'always',
			selector: '[data-tutorial="always"]',
			title: 'A',
			what: 'a',
			how: 'b',
			goal: 'c',
		},
		{ id: 'cond', selector: '[data-tutorial="cond"]', title: 'C', what: 'a', how: 'b', goal: 'c' },
	],
};

/** 条件付き (= `optional: true`) で宣言されているべき step */
const CONDITIONAL_STEP_IDS = [
	'home-pending',
	'home-monthly',
	'home-nav-desktop',
	'home-nav-mobile',
];
/** 常設 UI を指す (= `optional` を付けない) step */
const ALWAYS_STEP_IDS = ['home-summary', 'home-children', 'home-switch'];

describe('#4653 filterGuideStepsByTargetPresence', () => {
	it('描画済の対象を持つ step と selector 省略 step を残し、未描画の step を除外する', () => {
		const rendered = new Set(['[data-tutorial="always"]']);
		const filtered = filterGuideStepsByTargetPresence(fixture, (sel) => rendered.has(sel));
		expect(filtered?.steps.map((s) => s.id)).toEqual(['intro', 'always']);
	});

	it('全 step の対象が描画済なら順序を保って全て残す', () => {
		const filtered = filterGuideStepsByTargetPresence(fixture, () => true);
		expect(filtered?.steps.map((s) => s.id)).toEqual(['intro', 'always', 'cond']);
	});

	it('selector 付き step が全て未描画でも概要 step があれば null にならない', () => {
		const filtered = filterGuideStepsByTargetPresence(fixture, () => false);
		expect(filtered?.steps.map((s) => s.id)).toEqual(['intro']);
	});

	it('selector 付き step だけのガイドで全て未描画なら null (呼び出し側で起動抑止)', () => {
		const onlySelector: PageGuide = { ...fixture, steps: fixture.steps.slice(1) };
		expect(filterGuideStepsByTargetPresence(onlySelector, () => false)).toBeNull();
	});

	it('元のガイド object を変更しない (新しい steps 配列を返す)', () => {
		const before = fixture.steps.length;
		filterGuideStepsByTargetPresence(fixture, () => false);
		expect(fixture.steps.length).toBe(before);
	});

	it('ADMIN_HOME_GUIDE: desktop nav だけ描画 → mobile nav step が落ち、desktop nav step が残る (F2)', () => {
		const desktopRendered = new Set([
			'[data-tutorial="summary-cards"]',
			'[data-tutorial="monthly-summary"]',
			'[data-tutorial="children-overview"]',
			'[data-tutorial="switch-to-child"]',
			'[data-tutorial="nav-desktop"]',
		]);
		const filtered = filterGuideStepsByTargetPresence(ADMIN_HOME_GUIDE, (sel) =>
			desktopRendered.has(sel),
		);
		const ids = filtered?.steps.map((s) => s.id) ?? [];
		expect(ids).toContain('home-nav-desktop');
		expect(ids).not.toContain('home-nav-mobile');
		// 承認待ちバナー (交換申請 0 件で未描画) は出ない
		expect(ids).not.toContain('home-pending');
		// 概要は常に残る
		expect(ids[0]).toBe('home-intro');
	});
});

describe('#4653 isGuideTargetRendered (jsdom)', () => {
	it('document 上の最初の一致要素が box を持てば true、無ければ false', () => {
		if (typeof document === 'undefined') return; // node 環境 (jsdom 無し) では SSR 側 fail-closed のみ
		document.body.innerHTML = '<div data-tutorial="x"></div>';
		// jsdom は layout を持たず getClientRects() が常に空 → 描画判定は false (fail-closed)
		// ここでは「存在しない selector は false」と「不正 selector で例外を出さない」を固定する。
		expect(isGuideTargetRendered('[data-tutorial="nope"]')).toBe(false);
		expect(isGuideTargetRendered('[[[')).toBe(false);
	});
});

describe('#4653 ADMIN_HOME_GUIDE の条件付き step 宣言', () => {
	it('条件付き UI / viewport 別 nav の step だけが optional: true を持つ', () => {
		const optionalIds = ADMIN_HOME_GUIDE.steps.filter((s) => s.optional).map((s) => s.id);
		expect(optionalIds.sort()).toEqual([...CONDITIONAL_STEP_IDS].sort());
	});

	it('常設 UI を指す step には optional を付けない (anchor 退行を silent に隠さない)', () => {
		for (const id of ALWAYS_STEP_IDS) {
			const step = ADMIN_HOME_GUIDE.steps.find((s) => s.id === id);
			expect(step, `step ${id} が存在する`).toBeDefined();
			expect(step?.optional, `step ${id} は常設 UI`).toBeFalsy();
		}
	});

	it('概要 step は selector を持たず先頭にある (中央 modal でページ全体像を説明する)', () => {
		expect(ADMIN_HOME_GUIDE.steps[0]?.id).toBe('home-intro');
		expect(ADMIN_HOME_GUIDE.steps[0]?.selector).toBeUndefined();
	});
});

describe('#4653 filterGuideStepsByPresence 適用後の /admin ガイド', () => {
	it('desktop nav だけ描画 → mobile nav step が落ち、desktop nav step が残る (F2)', () => {
		const desktopRendered = new Set([
			'[data-tutorial="summary-cards"]',
			'[data-tutorial="monthly-summary"]',
			'[data-tutorial="children-overview"]',
			'[data-tutorial="switch-to-child"]',
			'[data-tutorial="nav-desktop"]',
		]);
		const ids =
			filterGuideStepsByPresence(ADMIN_HOME_GUIDE, (sel) => desktopRendered.has(sel))?.steps.map(
				(s) => s.id,
			) ?? [];
		expect(ids).toContain('home-nav-desktop');
		expect(ids).not.toContain('home-nav-mobile');
		// 承認待ちバナー (交換申請 0 件で未描画) は出ない
		expect(ids).not.toContain('home-pending');
		// 概要と常設 step は残り、画面の上から下の順が保たれる
		expect(ids[0]).toBe('home-intro');
		for (const id of ALWAYS_STEP_IDS) expect(ids).toContain(id);
	});

	it('mobile nav だけ描画 → desktop nav step が落ちる', () => {
		const mobileRendered = new Set([
			'[data-tutorial="summary-cards"]',
			'[data-tutorial="children-overview"]',
			'[data-tutorial="switch-to-child"]',
			'[data-tutorial="nav-primary"]',
		]);
		const ids =
			filterGuideStepsByPresence(ADMIN_HOME_GUIDE, (sel) => mobileRendered.has(sel))?.steps.map(
				(s) => s.id,
			) ?? [];
		expect(ids).toContain('home-nav-mobile');
		expect(ids).not.toContain('home-nav-desktop');
		// お子さま 0 人相当 (今月のがんばり未描画) でも常設 step は残る
		expect(ids).not.toContain('home-monthly');
	});

	it('条件付き対象が全て描画済なら宣言順のまま全 step が残る', () => {
		const ids = filterGuideStepsByPresence(ADMIN_HOME_GUIDE, () => true)?.steps.map((s) => s.id);
		expect(ids).toEqual(ADMIN_HOME_GUIDE.steps.map((s) => s.id));
	});

	it('ADMIN_HOME_GUIDE を変更しない (新しい steps 配列を返す)', () => {
		const before = ADMIN_HOME_GUIDE.steps.length;
		filterGuideStepsByPresence(ADMIN_HOME_GUIDE, () => false);
		expect(ADMIN_HOME_GUIDE.steps.length).toBe(before);
	});
});
