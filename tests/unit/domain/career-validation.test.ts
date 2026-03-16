// tests/unit/domain/career-validation.test.ts
// キャリアプランニング バリデーションのユニットテスト

import { describe, expect, it } from 'vitest';
import {
	mandalaChartSchema,
	createCareerPlanSchema,
	getCareerUiMode,
	createEmptyMandalaChart,
	CAREER_POINTS,
} from '../../../src/lib/domain/validation/career';

describe('career-validation', () => {
	describe('mandalaChartSchema', () => {
		it('有効なマンダラチャートを受理', () => {
			const result = mandalaChartSchema.safeParse({
				center: 'プログラマーになる',
				surrounding: [
					{ goal: '算数を得意にする', actions: ['計算ドリル', 'パズル'] },
					{ goal: '英語を覚える', actions: ['英単語', '英語アニメ'] },
				],
			});
			expect(result.success).toBe(true);
		});

		it('centerが空なら拒否', () => {
			const result = mandalaChartSchema.safeParse({
				center: '',
				surrounding: [],
			});
			expect(result.success).toBe(false);
		});

		it('centerが100文字超なら拒否', () => {
			const result = mandalaChartSchema.safeParse({
				center: 'あ'.repeat(101),
				surrounding: [],
			});
			expect(result.success).toBe(false);
		});

		it('surroundingが8個まで許容', () => {
			const surrounding = Array.from({ length: 8 }, (_, i) => ({
				goal: `目標${i}`,
				actions: [],
			}));
			const result = mandalaChartSchema.safeParse({
				center: 'テスト',
				surrounding,
			});
			expect(result.success).toBe(true);
		});

		it('surroundingが9個以上なら拒否', () => {
			const surrounding = Array.from({ length: 9 }, (_, i) => ({
				goal: `目標${i}`,
				actions: [],
			}));
			const result = mandalaChartSchema.safeParse({
				center: 'テスト',
				surrounding,
			});
			expect(result.success).toBe(false);
		});

		it('actionsが8個まで許容', () => {
			const result = mandalaChartSchema.safeParse({
				center: 'テスト',
				surrounding: [
					{ goal: '目標', actions: Array.from({ length: 8 }, (_, i) => `アクション${i}`) },
				],
			});
			expect(result.success).toBe(true);
		});
	});

	describe('createCareerPlanSchema', () => {
		it('最小限のプランを受理', () => {
			const result = createCareerPlanSchema.safeParse({});
			expect(result.success).toBe(true);
		});

		it('フルプランを受理', () => {
			const result = createCareerPlanSchema.safeParse({
				careerFieldId: 1,
				dreamText: 'かがくしゃになりたい',
				mandalaChart: { center: 'テスト', surrounding: [] },
				timeline3y: '実験をたくさんする',
				timeline5y: '大学に行く',
				timeline10y: '研究者になる',
			});
			expect(result.success).toBe(true);
		});

		it('dreamTextが200文字超なら拒否', () => {
			const result = createCareerPlanSchema.safeParse({
				dreamText: 'あ'.repeat(201),
			});
			expect(result.success).toBe(false);
		});

		it('careerFieldIdが負数なら拒否', () => {
			const result = createCareerPlanSchema.safeParse({
				careerFieldId: -1,
			});
			expect(result.success).toBe(false);
		});
	});

	describe('getCareerUiMode', () => {
		it('6歳はselectionモード', () => {
			expect(getCareerUiMode(6)).toBe('selection');
		});

		it('8歳はselectionモード', () => {
			expect(getCareerUiMode(8)).toBe('selection');
		});

		it('9歳はsemi-freeモード', () => {
			expect(getCareerUiMode(9)).toBe('semi-free');
		});

		it('10歳はsemi-freeモード', () => {
			expect(getCareerUiMode(10)).toBe('semi-free');
		});

		it('11歳はfullモード', () => {
			expect(getCareerUiMode(11)).toBe('full');
		});

		it('12歳はfullモード', () => {
			expect(getCareerUiMode(12)).toBe('full');
		});
	});

	describe('createEmptyMandalaChart', () => {
		it('空のマンダラチャートを生成', () => {
			const chart = createEmptyMandalaChart();
			expect(chart.center).toBe('');
			expect(chart.surrounding).toHaveLength(8);
			expect(chart.surrounding[0]).toEqual({ goal: '', actions: [] });
		});
	});

	describe('CAREER_POINTS', () => {
		it('ポイント定数が正しく定義されている', () => {
			expect(CAREER_POINTS.MANDALA_CREATE).toBe(500);
			expect(CAREER_POINTS.MANDALA_UPDATE).toBe(100);
			expect(CAREER_POINTS.TIMELINE_CREATE).toBe(300);
			expect(CAREER_POINTS.TIMELINE_UPDATE).toBe(100);
			expect(CAREER_POINTS.ACTIVITY_BONUS).toBe(50);
		});
	});
});
