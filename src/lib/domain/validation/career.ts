import { z } from 'zod';

// ============================================================
// ポイント定数
// ============================================================
export const CAREER_POINTS = {
	MANDALA_CREATE: 500,
	MANDALA_UPDATE: 100,
	TIMELINE_CREATE: 300,
	TIMELINE_UPDATE: 100,
	ACTIVITY_BONUS: 50,
} as const;

// ============================================================
// マンダラチャート JSON スキーマ
// ============================================================
export const mandalaGoalSchema = z.object({
	goal: z.string().max(100).default(''),
	actions: z.array(z.string().max(100)).max(8).default([]),
});

export const mandalaChartSchema = z.object({
	center: z.string().min(1).max(100),
	surrounding: z.array(mandalaGoalSchema).max(8).default([]),
});

export type MandalaGoal = z.infer<typeof mandalaGoalSchema>;
export type MandalaChart = z.infer<typeof mandalaChartSchema>;

// ============================================================
// キャリアプラン作成・更新スキーマ
// ============================================================
export const createCareerPlanSchema = z.object({
	careerFieldId: z.number().int().positive().optional(),
	dreamText: z.string().max(200).optional(),
	mandalaChart: mandalaChartSchema.optional(),
	timeline3y: z.string().max(200).optional(),
	timeline5y: z.string().max(200).optional(),
	timeline10y: z.string().max(200).optional(),
});

export const updateCareerPlanSchema = z.object({
	careerFieldId: z.number().int().positive().optional(),
	dreamText: z.string().max(200).optional(),
	mandalaChart: mandalaChartSchema.optional(),
	timeline3y: z.string().max(200).optional(),
	timeline5y: z.string().max(200).optional(),
	timeline10y: z.string().max(200).optional(),
});

export type CreateCareerPlanInput = z.infer<typeof createCareerPlanSchema>;
export type UpdateCareerPlanInput = z.infer<typeof updateCareerPlanSchema>;

// ============================================================
// 年齢別UIモード
// ============================================================
export type CareerUiMode = 'selection' | 'semi-free' | 'full';

export function getCareerUiMode(age: number): CareerUiMode {
	if (age <= 8) return 'selection';
	if (age <= 10) return 'semi-free';
	return 'full';
}

// ============================================================
// 空のマンダラチャート
// ============================================================
export function createEmptyMandalaChart(): MandalaChart {
	return {
		center: '',
		surrounding: Array.from({ length: 8 }, () => ({ goal: '', actions: [] })),
	};
}
