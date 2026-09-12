import { asChildId } from '$lib/domain/ids';
// tests/unit/services/questionnaire-service.test.ts
// questionnaire-service ユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Top-level mocks ----

const mockCreateTemplate = vi.fn();
const mockAddTemplateItem = vi.fn();

vi.mock('$lib/server/services/checklist-service', () => ({
	createTemplate: (...args: unknown[]) => mockCreateTemplate(...args),
	addTemplateItem: (...args: unknown[]) => mockAddTemplateItem(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	applyChecklistPresets,
	getActivityDisplayCount,
	getRecommendedCategories,
	getRecommendedPresets,
} from '$lib/server/services/questionnaire-service';

// ---- Constants ----

const ALL_CATEGORIES = ['undou', 'benkyou', 'seikatsu', 'souzou', 'kouryuu'];
const TENANT = 'test-tenant';
const CHILD_ID = asChildId(1);

// ---- Tests ----

describe('questionnaire-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ========================================
	// getRecommendedCategories
	// ========================================
	describe('getRecommendedCategories', () => {
		// 新 3 軸（#1592 ADR-0023 I4）
		describe('新 3 軸 (#1592)', () => {
			it('homework-daily → benkyou を返す', () => {
				const result = getRecommendedCategories(['homework-daily']);
				expect(result).toEqual(['benkyou']);
			});

			it('chores → seikatsu を返す', () => {
				const result = getRecommendedCategories(['chores']);
				expect(result).toEqual(['seikatsu']);
			});

			it('beyond-games → souzou + undou + kouryuu を返す', () => {
				const result = getRecommendedCategories(['beyond-games']);
				expect(result).toContain('souzou');
				expect(result).toContain('undou');
				expect(result).toContain('kouryuu');
				expect(result).toHaveLength(3);
			});

			it('3 軸全選択 → 5 カテゴリ（重複除去）を返す', () => {
				const result = getRecommendedCategories(['homework-daily', 'chores', 'beyond-games']);
				expect(result).toContain('benkyou');
				expect(result).toContain('seikatsu');
				expect(result).toContain('souzou');
				expect(result).toContain('undou');
				expect(result).toContain('kouryuu');
				expect(result).toHaveLength(5);
			});
		});

		// 旧キー（後方互換 / 廃止予定）
		describe('旧キー後方互換', () => {
			it('morning → seikatsu を返す', () => {
				const result = getRecommendedCategories(['morning']);
				expect(result).toEqual(['seikatsu']);
			});

			it('homework → benkyou を返す', () => {
				const result = getRecommendedCategories(['homework']);
				expect(result).toEqual(['benkyou']);
			});

			it('exercise → undou を返す', () => {
				const result = getRecommendedCategories(['exercise']);
				expect(result).toEqual(['undou']);
			});

			it('picky → seikatsu を返す', () => {
				const result = getRecommendedCategories(['picky']);
				expect(result).toEqual(['seikatsu']);
			});

			it('balanced → 全5カテゴリを返す', () => {
				const result = getRecommendedCategories(['balanced']);
				expect(result).toHaveLength(5);
				for (const cat of ALL_CATEGORIES) {
					expect(result).toContain(cat);
				}
			});
		});

		it('複数課題の組み合わせ → 重複なしで和集合を返す', () => {
			const result = getRecommendedCategories(['morning', 'homework', 'exercise']);
			expect(result).toContain('seikatsu');
			expect(result).toContain('benkyou');
			expect(result).toContain('undou');
			// morning と chores は同じ seikatsu なので重複しない
			const seikatsuCount = result.filter((c) => c === 'seikatsu').length;
			expect(seikatsuCount).toBe(1);
		});

		it('空配列 → 全5カテゴリをフォールバックとして返す', () => {
			const result = getRecommendedCategories([]);
			expect(result).toHaveLength(5);
			for (const cat of ALL_CATEGORIES) {
				expect(result).toContain(cat);
			}
		});

		it('未知の課題のみ → 全5カテゴリをフォールバックとして返す', () => {
			const result = getRecommendedCategories(['unknown-challenge']);
			expect(result).toHaveLength(5);
			for (const cat of ALL_CATEGORIES) {
				expect(result).toContain(cat);
			}
		});
	});

	// ========================================
	// getRecommendedPresets
	// ========================================
	describe('getRecommendedPresets', () => {
		// 新 3 軸（#1592 ADR-0023 I4）
		describe('新 3 軸 (#1592)', () => {
			it('homework-daily → after-school + morning-routine + evening-routine', () => {
				const result = getRecommendedPresets(['homework-daily']);
				expect(result).toContain('after-school');
				expect(result).toContain('morning-routine');
				expect(result).toContain('evening-routine');
			});

			it('chores → weekend-chores + morning-routine + evening-routine', () => {
				const result = getRecommendedPresets(['chores']);
				expect(result).toContain('weekend-chores');
				expect(result).toContain('morning-routine');
				expect(result).toContain('evening-routine');
			});

			it('beyond-games → beyond-games + morning-routine + evening-routine', () => {
				const result = getRecommendedPresets(['beyond-games']);
				expect(result).toContain('beyond-games');
				expect(result).toContain('morning-routine');
				expect(result).toContain('evening-routine');
			});

			it('3 軸全選択 → 全プリセット（重複除去）', () => {
				const result = getRecommendedPresets(['homework-daily', 'chores', 'beyond-games']);
				expect(result).toContain('after-school');
				expect(result).toContain('weekend-chores');
				expect(result).toContain('beyond-games');
				expect(result).toContain('morning-routine');
				expect(result).toContain('evening-routine');
				expect(result).toHaveLength(5);
			});
		});

		// 旧キー後方互換
		describe('旧キー後方互換', () => {
			it('morning → morning-routine + evening-routine を含む', () => {
				const result = getRecommendedPresets(['morning']);
				expect(result).toContain('morning-routine');
				expect(result).toContain('evening-routine');
			});

			it('homework → after-school + morning-routine + evening-routine を含む', () => {
				const result = getRecommendedPresets(['homework']);
				expect(result).toContain('after-school');
				expect(result).toContain('morning-routine');
				expect(result).toContain('evening-routine');
			});

			it('exercise → morning-routine + evening-routine のみ（追加プリセットなし）', () => {
				const result = getRecommendedPresets(['exercise']);
				expect(result).toEqual(expect.arrayContaining(['morning-routine', 'evening-routine']));
				expect(result).toHaveLength(2);
			});

			it('balanced → morning-routine + evening-routine（重複なし）', () => {
				const result = getRecommendedPresets(['balanced']);
				expect(result).toContain('morning-routine');
				expect(result).toContain('evening-routine');
				// balanced の CHALLENGE_CHECKLIST_MAP は ['morning-routine', 'evening-routine'] なので
				// 追加の always-include と重複除去されて 2 件
				expect(result).toHaveLength(2);
			});
		});

		it('空配列 → 最低限 morning-routine + evening-routine を返す', () => {
			const result = getRecommendedPresets([]);
			expect(result).toContain('morning-routine');
			expect(result).toContain('evening-routine');
			expect(result).toHaveLength(2);
		});
	});

	// ========================================
	// getActivityDisplayCount
	// ========================================
	describe('getActivityDisplayCount', () => {
		it('few → 10 を返す', () => {
			expect(getActivityDisplayCount('few')).toBe(10);
		});

		it('normal → 20 を返す', () => {
			expect(getActivityDisplayCount('normal')).toBe(20);
		});

		it('many → 50 を返す', () => {
			expect(getActivityDisplayCount('many')).toBe(50);
		});
	});

	// ========================================
	// applyChecklistPresets
	// ========================================
	describe('applyChecklistPresets', () => {
		// #4907: loadPreset は build-time bundled JSON ($lib/data/setup-checklist-presets) から
		// 同期的に読むため、fetch モックでは差し替えられない。実データ (morning-routine.json:
		// あさのしたく / はみがき・かおをあらう・きがえ・あさごはん・もちものチェックの 5 item) を
		// そのまま期待値に使う。

		it('プリセットを正常に適用しテンプレート数を返す', async () => {
			mockCreateTemplate.mockResolvedValue({ id: '100' });
			mockAddTemplateItem.mockResolvedValue({});

			const created = await applyChecklistPresets(CHILD_ID, ['morning-routine'], TENANT);

			expect(created).toBe(1);
			expect(mockCreateTemplate).toHaveBeenCalledWith(
				{
					childId: CHILD_ID,
					name: 'あさのしたく',
					icon: '☀️',
					pointsPerItem: 2,
					completionBonus: 5,
					sourcePresetId: 'morning-routine',
				},
				TENANT,
			);
			expect(mockAddTemplateItem).toHaveBeenCalledTimes(5);
			expect(mockAddTemplateItem).toHaveBeenCalledWith(
				{ templateId: '100', name: 'はみがき', icon: '🪥', sortOrder: 1 },
				TENANT,
			);
		});

		it('存在しないプリセットはスキップして 0 を返す', async () => {
			const created = await applyChecklistPresets(CHILD_ID, ['nonexistent-preset'], TENANT);

			expect(created).toBe(0);
			expect(mockCreateTemplate).not.toHaveBeenCalled();
		});

		it('createTemplate がエラーを投げても他のプリセットを続行する', async () => {
			// 1つ目 (morning-routine) はエラー、2つ目 (evening-routine) は成功
			mockCreateTemplate
				.mockRejectedValueOnce(new Error('DB error'))
				.mockResolvedValueOnce({ id: '200' });
			mockAddTemplateItem.mockResolvedValue({});

			const created = await applyChecklistPresets(
				CHILD_ID,
				['morning-routine', 'evening-routine'],
				TENANT,
			);

			// morning-routine は失敗、evening-routine は成功 → 1
			expect(created).toBe(1);
		});

		it('空のプリセットID配列 → 0 を返し何も呼ばない', async () => {
			const created = await applyChecklistPresets(CHILD_ID, [], TENANT);

			expect(created).toBe(0);
			expect(mockCreateTemplate).not.toHaveBeenCalled();
			expect(mockAddTemplateItem).not.toHaveBeenCalled();
		});
	});
});
