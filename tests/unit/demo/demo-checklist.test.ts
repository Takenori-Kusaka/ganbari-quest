// tests/unit/demo/demo-checklist.test.ts
// #704: getDemoTodayChecklistsForChild のユニットテスト
// - 持ち物純化（#1755 / #1709-A）以降、テンプレートを持つ年齢の childId でテンプレートが返る
// - items は sortOrder 順
// - checkedCount / totalCount / completedAll / pointsAwarded の整合性

import { describe, expect, it } from 'vitest';
import { getDemoTodayChecklistsForChild } from '../../../src/lib/server/demo/demo-service';

// #703 + #1755: 5 人構成
// 901(baby たろう), 902(preschool はなこ), 903(elementary けんた), 904(junior さくら), 906(senior ゆうき)
//
// #1755 (#1709-A): kind 削除に伴い、旧 routine テンプレートを持っていた以下 child は demo data から除外:
// - 902 (はなこ → routine 'あさのしたく')
// - 903 (けんた → routine 'よるのじゅんび')
// 残存テンプレートを持つ child は 901 / 904 / 906（全て持ち物系）。
// items / 整合性チェックは template を持つ全 child 共通で走らせる。
const DEMO_CHILD_IDS = [901, 902, 903, 904, 906];
const CHILDREN_WITH_TEMPLATES = [901, 904, 906];

describe('getDemoTodayChecklistsForChild (#704)', () => {
	for (const childId of CHILDREN_WITH_TEMPLATES) {
		it(`childId=${childId} で空でないチェックリストを返す`, () => {
			const result = getDemoTodayChecklistsForChild(childId);
			expect(result.length).toBeGreaterThan(0);
		});
	}

	// #1755 (#1709-A): kind=routine テンプレートを持っていた child は持ち物純化で空になる
	for (const childId of [902, 903]) {
		it(`childId=${childId} は kind=routine 削除（#1755）で空配列を返す`, () => {
			const result = getDemoTodayChecklistsForChild(childId);
			expect(result.length).toBe(0);
		});
	}

	it('各チェックリストの items は sortOrder 順', () => {
		for (const childId of DEMO_CHILD_IDS) {
			const checklists = getDemoTodayChecklistsForChild(childId);
			for (const cl of checklists) {
				expect(cl.items.length).toBeGreaterThan(0);
				// reduce で隣接ペアを比較 — インデックスアクセス不要で型安全
				cl.items.reduce((prev, curr) => {
					expect(curr.id).toBeGreaterThan(prev.id);
					return curr;
				});
			}
		}
	});

	it('checkedCount / totalCount / completedAll の整合性', () => {
		for (const childId of DEMO_CHILD_IDS) {
			const checklists = getDemoTodayChecklistsForChild(childId);
			for (const cl of checklists) {
				const actualChecked = cl.items.filter((i) => i.checked).length;
				expect(cl.checkedCount).toBe(actualChecked);
				expect(cl.totalCount).toBe(cl.items.length);
				expect(cl.completedAll).toBe(actualChecked === cl.totalCount && cl.totalCount > 0);
			}
		}
	});

	it('pointsAwarded は completedAll のときのみ正値', () => {
		for (const childId of DEMO_CHILD_IDS) {
			const checklists = getDemoTodayChecklistsForChild(childId);
			for (const cl of checklists) {
				if (cl.completedAll) {
					expect(cl.pointsAwarded).toBe(cl.totalCount * cl.pointsPerItem + cl.completionBonus);
				} else {
					expect(cl.pointsAwarded).toBe(0);
				}
			}
		}
	});

	it('存在しない childId は空配列を返す', () => {
		const result = getDemoTodayChecklistsForChild(9999);
		expect(result).toEqual([]);
	});
});
