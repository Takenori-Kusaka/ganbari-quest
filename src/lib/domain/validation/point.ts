import { z } from 'zod';

/** 変換モード */
export const ConvertMode = {
	PRESET: 'preset',
	MANUAL: 'manual',
	RECEIPT: 'receipt',
} as const;
export type ConvertMode = (typeof ConvertMode)[keyof typeof ConvertMode];

/** ポイント変換スキーマ（プリセット: 500P単位） */
export const convertPointsPresetSchema = z.object({
	childId: z.number().int().positive(),
	amount: z.number().int().positive().multipleOf(500),
	mode: z.literal(ConvertMode.PRESET),
});

/** ポイント変換スキーマ（自由入力: 1P単位） */
export const convertPointsManualSchema = z.object({
	childId: z.number().int().positive(),
	amount: z.number().int().min(1),
	mode: z.literal(ConvertMode.MANUAL),
});

/** ポイント変換スキーマ（領収書: 1P単位） */
export const convertPointsReceiptSchema = z.object({
	childId: z.number().int().positive(),
	amount: z.number().int().min(1),
	mode: z.literal(ConvertMode.RECEIPT),
});

/** ポイント変換スキーマ（統合） */
export const convertPointsSchema = z.discriminatedUnion('mode', [
	convertPointsPresetSchema,
	convertPointsManualSchema,
	convertPointsReceiptSchema,
]);

/** ポイント履歴クエリスキーマ */
export const pointHistoryQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

/** ポイント変換レート: 500P = 500円相当 */
export const POINTS_PER_CONVERT_UNIT = 500;
