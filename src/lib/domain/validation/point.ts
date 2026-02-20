import { z } from 'zod';

/** ポイント変換スキーマ（500P単位） */
export const convertPointsSchema = z.object({
	childId: z.number().int().positive(),
	amount: z.number().int().positive().multipleOf(500),
});

/** ポイント履歴クエリスキーマ */
export const pointHistoryQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

/** ポイント変換レート: 500P = 500円相当 */
export const POINTS_PER_CONVERT_UNIT = 500;
