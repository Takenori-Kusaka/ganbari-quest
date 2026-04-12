import { describe, expect, it } from 'vitest';
import { getDefaultUiMode } from '../../../src/lib/domain/validation/age-tier';
import { DEMO_CHILDREN, getDemoActivitiesForChild } from '../../../src/lib/server/demo/demo-data';

describe('demo data integrity (#562)', () => {
	describe('DEMO_CHILDREN', () => {
		it.each(
			DEMO_CHILDREN,
		)('$nickname (age $age) の uiMode が getDefaultUiMode(age) と一致する', (child) => {
			const expected = getDefaultUiMode(child.age);
			expect(child.uiMode).toBe(expected);
		});

		it('子どもの年齢と区分が新仕様 #537 と整合している', () => {
			const summary = DEMO_CHILDREN.map((c) => ({
				nickname: c.nickname,
				age: c.age,
				uiMode: c.uiMode,
				expected: getDefaultUiMode(c.age),
			}));
			const mismatches = summary.filter((s) => s.uiMode !== s.expected);
			expect(mismatches).toEqual([]);
		});
	});

	// #703: 5 人構成 + 各年齢帯のテーマカラー一意性 + 活動の年齢フィルタ整合
	describe('DEMO_CHILDREN 5人構成 (#703)', () => {
		it('ちょうど 5 人で、想定の childId のみが含まれる', () => {
			const ids = DEMO_CHILDREN.map((c) => c.id).sort((a, b) => a - b);
			expect(ids).toEqual([901, 902, 903, 904, 906]);
		});

		it('5 つの uiMode (baby/preschool/elementary/junior/senior) を 1 人ずつ持つ', () => {
			const modes = DEMO_CHILDREN.map((c) => c.uiMode).sort();
			expect(modes).toEqual(['baby', 'elementary', 'junior', 'preschool', 'senior']);
		});

		it('5 つのテーマカラー (blue/pink/green/purple/orange) を 1 人ずつ持つ', () => {
			const themes = DEMO_CHILDREN.map((c) => c.theme).sort();
			expect(themes).toEqual(['blue', 'green', 'orange', 'pink', 'purple']);
		});
	});

	// #703: 活動の年齢フィルタ — 過去に「中学生のさくらに はいはい が出る」「乳児のたろうに 受験勉強 が出る」
	// という不整合バグがあったため、回帰防止として境界活動を明示的に検証する。
	describe('getDemoActivitiesForChild の年齢フィルタ (#703)', () => {
		// 各代表年齢に対し「絶対に出現してはいけない」「必ず出現すべき」活動 id ペア
		const cases = [
			{
				nickname: 'たろう (1歳/baby)',
				age: 1,
				mustInclude: [1, 2, 3], // はいはい / あんよ / おそとにでた
				mustExclude: [13, 16, 17, 18], // しゅくだい / 自主学習 / 受験勉強 / 資格検定
			},
			{
				nickname: 'はなこ (5歳/preschool)',
				age: 5,
				mustInclude: [4, 6, 10, 12], // からだ / ダンス / えほん / ひらがな
				mustExclude: [1, 13, 17], // はいはい / しゅくだい / 受験勉強
			},
			{
				nickname: 'けんた (8歳/elementary)',
				age: 8,
				mustInclude: [5, 7, 13, 14, 15], // なわとび / うんどう / しゅくだい / どくしょ / けいさん
				mustExclude: [1, 2, 17, 18], // はいはい / あんよ / 受験勉強 / 資格検定
			},
			{
				nickname: 'さくら (14歳/junior)',
				age: 14,
				mustInclude: [7, 13, 14, 16, 17, 18], // うんどう / しゅくだい / どくしょ / 自主学習 / 受験勉強 / 資格検定
				mustExclude: [1, 2, 5, 6, 11, 12], // はいはい / あんよ / なわとび(〜9) / ダンス(〜9) / すうじ / ひらがな
			},
			{
				nickname: 'ゆうき (17歳/senior)',
				age: 17,
				mustInclude: [7, 13, 14, 16, 17, 18],
				mustExclude: [1, 2, 5, 6, 10, 11, 12],
			},
		];

		for (const c of cases) {
			it(`${c.nickname} の活動リストに想定の包含/除外がある`, () => {
				const ids = new Set(getDemoActivitiesForChild(c.age).map((a) => a.id));
				for (const id of c.mustInclude) {
					expect(ids.has(id), `id=${id} は age=${c.age} に含まれるべき`).toBe(true);
				}
				for (const id of c.mustExclude) {
					expect(ids.has(id), `id=${id} は age=${c.age} に含まれてはいけない`).toBe(false);
				}
			});
		}
	});
});
