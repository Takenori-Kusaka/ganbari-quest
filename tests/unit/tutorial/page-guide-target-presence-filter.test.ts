// tests/unit/tutorial/page-guide-target-presence-filter.test.ts
// #4653 (EPIC #4650 PO 判断 4): /admin ホームガイドの「条件付き step が描画時だけ出る」回帰ガード。
//
// ガイド step の selector が「条件付き UI (承認待ちバナー / 今月のがんばり) / viewport 別 nav
// (desktop: header 下 / mobile: 画面下部)」を指すとき、対象が描画されていない step をそのまま
// driver.js に渡すと中央 dummy (0×0) か display:none 要素の 0×0 spotlight になる
// (/admin desktop step 3 の実害)。ADMIN_HOME_GUIDE 側はこれらの step に `optional: true` を付け、
// 起動直前に `filterGuideStepsByPresence` (#4668 / #4677、汎用挙動は page-guide-runtime-filter.test.ts)
// が「対象が描画済の step だけ」を残す。本 suite は /admin の宣言が意図どおりであることを固定する。

import { describe, expect, it } from 'vitest';
import { filterGuideStepsByPresence } from '../../../src/lib/ui/tutorial/page-guide-registry';
import { ADMIN_HOME_GUIDE } from '../../../src/routes/(parent)/admin/_guide';

/** 条件付き (= `optional: true`) で宣言されているべき step */
const CONDITIONAL_STEP_IDS = ['home-pending', 'home-monthly', 'home-nav-desktop', 'home-nav-mobile'];
/** 常設 UI を指す (= `optional` を付けない) step */
const ALWAYS_STEP_IDS = ['home-summary', 'home-children', 'home-switch'];

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

	it('元のガイド object を変更しない (新しい steps 配列を返す)', () => {
		const before = ADMIN_HOME_GUIDE.steps.length;
		filterGuideStepsByPresence(ADMIN_HOME_GUIDE, () => false);
		expect(ADMIN_HOME_GUIDE.steps.length).toBe(before);
	});
});
