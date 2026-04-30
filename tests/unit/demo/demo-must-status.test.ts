// tests/unit/demo/demo-must-status.test.ts
// #1757 (#1709-C): demo getDemoHomeData の mustStatus 集計を検証する。
// - DEMO_ACTIVITIES に priority='must' が複数定義されており、age フィルタ後に
//   mustStatus.total が 1 件以上になる年齢帯がある（preschool/elementary/junior/senior）。
// - baby は呼び出し側で UI 非表示にするため、demo-service 側は計算結果を返してよい。
// - demo は DB 書き込みなし → granted は常に false。

import { describe, expect, it } from 'vitest';
import { DEMO_CHILDREN } from '../../../src/lib/server/demo/demo-data';
import { getDemoHomeData } from '../../../src/lib/server/demo/demo-service';

describe('#1757 demo mustStatus', () => {
	it('preschool 子供（901 ではない）の demo home に mustStatus が含まれる', () => {
		const preschoolChild = DEMO_CHILDREN.find((c) => c.uiMode === 'preschool');
		expect(preschoolChild).toBeDefined();
		const home = getDemoHomeData(preschoolChild?.id ?? 0);
		expect(home.mustStatus).not.toBeNull();
		expect(home.mustStatus?.total).toBeGreaterThan(0);
		// demo は DB 書き込み無しなので granted は常に false
		expect(home.mustStatus?.granted).toBe(false);
	});

	it('elementary 子供で must 活動 total >= 1', () => {
		const elem = DEMO_CHILDREN.find((c) => c.uiMode === 'elementary');
		expect(elem).toBeDefined();
		const home = getDemoHomeData(elem?.id ?? 0);
		expect(home.mustStatus).not.toBeNull();
		expect(home.mustStatus?.total).toBeGreaterThan(0);
	});

	it('junior 子供で must 活動 total >= 1', () => {
		const jr = DEMO_CHILDREN.find((c) => c.uiMode === 'junior');
		expect(jr).toBeDefined();
		const home = getDemoHomeData(jr?.id ?? 0);
		expect(home.mustStatus).not.toBeNull();
		expect(home.mustStatus?.total).toBeGreaterThan(0);
	});

	it('senior 子供で must 活動 total >= 1', () => {
		const sr = DEMO_CHILDREN.find((c) => c.uiMode === 'senior');
		expect(sr).toBeDefined();
		const home = getDemoHomeData(sr?.id ?? 0);
		expect(home.mustStatus).not.toBeNull();
		expect(home.mustStatus?.total).toBeGreaterThan(0);
	});

	it('存在しない childId は mustStatus=null', () => {
		const home = getDemoHomeData(99999);
		expect(home.mustStatus).toBeNull();
	});

	it('mustStatus.points は uiMode に応じた値（preschool=5 / junior=3）', () => {
		const preschool = DEMO_CHILDREN.find((c) => c.uiMode === 'preschool');
		const junior = DEMO_CHILDREN.find((c) => c.uiMode === 'junior');
		const preschoolHome = getDemoHomeData(preschool?.id ?? 0);
		const juniorHome = getDemoHomeData(junior?.id ?? 0);
		// allComplete=true ならば points は uiMode 別、false なら 0
		if (preschoolHome.mustStatus?.allComplete) {
			expect(preschoolHome.mustStatus.points).toBe(5);
		} else {
			expect(preschoolHome.mustStatus?.points).toBe(0);
		}
		if (juniorHome.mustStatus?.allComplete) {
			expect(juniorHome.mustStatus.points).toBe(3);
		} else {
			expect(juniorHome.mustStatus?.points).toBe(0);
		}
	});
});
