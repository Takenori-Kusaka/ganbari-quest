// tests/unit/demo/demo-checklist.test.ts
// #704: getDemoTodayChecklistsForChild のユニットテスト
// - 全 5 年齢の childId でテンプレートが返る（404 回帰防止）
// - items は sortOrder 順
// - checkedCount / totalCount / completedAll / pointsAwarded の整合性

import { describe, expect, it } from 'vitest';
import { getDemoTodayChecklistsForChild } from '../../../src/lib/server/demo/demo-service';

// デモ子供 ID: 901(baby), 902(preschool), 903(elementary低), 904(junior), 905(elementary高), 906(senior)
const DEMO_CHILD_IDS = [901, 902, 903, 904, 905, 906];

describe('getDemoTodayChecklistsForChild (#704)', () => {
	for (const childId of DEMO_CHILD_IDS) {
		it(`childId=${childId} で空でないチェックリストを返す`, () => {
			const result = getDemoTodayChecklistsForChild(childId);
			expect(result.length).toBeGreaterThan(0);
		});
	}

	it('各チェックリストの items は sortOrder 順', () => {
		for (const childId of DEMO_CHILD_IDS) {
			const checklists = getDemoTodayChecklistsForChild(childId);
			for (const cl of checklists) {
				// source items are sorted; checked items should maintain order
				for (let i = 1; i < cl.items.length; i++) {
					const curr = cl.items[i];
					const prev = cl.items[i - 1];
					// items.id should be increasing (sortOrder was applied)
					expect(curr).toBeDefined();
					expect(prev).toBeDefined();
					expect(curr!.id).toBeGreaterThan(prev!.id);
				}
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
