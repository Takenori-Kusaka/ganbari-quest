import { z } from 'zod';
import { ACTIVITY_SOURCE_WIRE_VALUES } from '$lib/domain/activity-source';
import {
	CATEGORY_CODES,
	CATEGORIES as CATEGORY_SSOT,
	type CategoryCode,
	type CategoryName,
} from '$lib/domain/categories';
import { asCategoryId, type CategoryId } from '$lib/domain/ids';
import { activityIdSchema, categoryIdSchema, childIdSchema } from './id-schema';

export type { CategoryCode };
// #3607: カテゴリ id↔code↔表示メタの SSOT は $lib/domain/categories.ts へ移設。
// CATEGORY_CODES / CategoryCode は後方互換のため本モジュールから re-export を維持する。
export { CATEGORY_CODES };

export type Category = CategoryName;

/** 日本語表示名一覧 (SSOT 派生)。新規参照は $lib/domain/categories.ts を直接使うこと */
export const CATEGORIES: readonly Category[] = CATEGORY_CODES.map(
	(code) => CATEGORY_SSOT[code].name,
);

// ============================================================
// カテゴリマスタ定義（サロゲートキー、#3607 で SSOT 派生化）
// ============================================================
export interface CategoryDef {
	readonly id: CategoryId;
	readonly code: CategoryCode;
	readonly name: Category;
	readonly icon: string;
	readonly color: string;
	readonly accent: string;
}

export const CATEGORY_DEFS: readonly CategoryDef[] = CATEGORY_CODES.map((code) => ({
	id: asCategoryId(CATEGORY_SSOT[code].legacyNumericId),
	code,
	name: CATEGORY_SSOT[code].name,
	icon: CATEGORY_SSOT[code].icon,
	color: CATEGORY_SSOT[code].color,
	accent: CATEGORY_SSOT[code].accent,
}));

export const CATEGORY_IDS = CATEGORY_DEFS.map((c) => c.id) as [CategoryId, ...CategoryId[]];

export function getCategoryById(id: CategoryId): CategoryDef | undefined {
	return CATEGORY_DEFS.find((c) => c.id === id);
}

export function getCategoryByCode(code: string): CategoryDef | undefined {
	return CATEGORY_DEFS.find((c) => c.code === code);
}

export function getCategoryByName(name: string): CategoryDef | undefined {
	return CATEGORY_DEFS.find((c) => c.name === name);
}

export const GRADE_LEVELS = [
	'baby',
	'kinder',
	'elementary_lower',
	'elementary_upper',
	'middle_school',
	'high_school',
] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

// #3669: source 意味論の SSOT は $lib/domain/activity-source.ts。本 tuple は wire 受理値域
// (zod enum 用) の再 export。'parent' は legacy wire 値で persist 前に 'custom' へ正規化される。
export const SOURCES = ACTIVITY_SOURCE_WIRE_VALUES;

export type Source = (typeof SOURCES)[number];

// ============================================================
// 活動 値域 SSOT (#3151 / ADR-0066)
// ============================================================
// domain Zod schema (本ファイル createActivitySchema) と wire Valibot schema
// (src/lib/marketplace/schemas/activity-pack-schema.ts) の両方が本定数を参照する。
// 値域 literal の二重定義は #3132 (値域ドリフト blocker) の root class のため禁止。
// domain⊆wire 包含は tests/unit/architecture/schema-range-ssot.test.ts が機械表明する。

export const ACTIVITY_NAME_MIN = 1;
export const ACTIVITY_NAME_MAX = 50;
export const ACTIVITY_BASE_POINTS_MIN = 1;
/** ポイント経済設計の上限 (初期 #0013 から不変)。wire 側旧 maxValue(10000) は #3151 で本値に統一 */
export const ACTIVITY_BASE_POINTS_MAX = 100;
export const ACTIVITY_AGE_MIN = 0;
/** domain 側が先行 SSOT (0〜20)。wire 側旧 maxValue(18) は #3151 で本値に統一 (既存行の往復保証) */
export const ACTIVITY_AGE_MAX = 20;
export const ACTIVITY_TRIGGER_HINT_MAX = 30;
export const ACTIVITY_DESCRIPTION_MAX = 200;
export const ACTIVITY_SUBCATEGORY_MAX = 50;
export const ACTIVITY_ICON_MIN_GRAPHEMES = 1;
export const ACTIVITY_ICON_MAX_GRAPHEMES = 2;

// #3463: dailyLimit / nameKana / nameKanji の許容境界 SSOT (form zod と同値)。
export const DAILY_LIMIT_MIN = 0;
export const DAILY_LIMIT_MAX = 99;
export const ACTIVITY_NAME_FIELD_MAX = 50;

/** grapheme cluster 数を数える (ZWJ 連結絵文字を 1 と数える)。icon 値域判定の共有実装 (#3151) */
export function countIconGraphemes(val: string): number {
	const seg = new Intl.Segmenter('ja', { granularity: 'grapheme' });
	return [...seg.segment(val)].length;
}

/**
 * icon 値域 (1〜2 grapheme) 判定。domain Zod refine と wire Valibot check の共有 oracle (#3151)。
 * 旧 wire 側 maxLength(20) (UTF-16 units 基準) は ZWJ 連結絵文字 2 個 (22 units) を弾き
 * domain⊆wire を破っていたため、本関数への統一で値域を表現方式ごと SSOT 化した。
 */
export function isValidActivityIcon(val: string): boolean {
	const count = countIconGraphemes(val);
	return count >= ACTIVITY_ICON_MIN_GRAPHEMES && count <= ACTIVITY_ICON_MAX_GRAPHEMES;
}

export const createActivitySchema = z.object({
	name: z.string().min(ACTIVITY_NAME_MIN).max(ACTIVITY_NAME_MAX),
	// #3575: id は opaque string。旧クライアント/テストの number も境界で as* 変換して受ける
	categoryId: z
		.union([z.string(), z.number()])
		.transform((v) => asCategoryId(v))
		.refine((v) => CATEGORY_DEFS.some((c) => c.id === v), {
			message: 'カテゴリが不正です',
		}),
	icon: z
		.string()
		.min(1)
		.refine(isValidActivityIcon, { message: 'アイコンは1〜2つの絵文字で指定してください' }),
	basePoints: z.number().int().min(ACTIVITY_BASE_POINTS_MIN).max(ACTIVITY_BASE_POINTS_MAX),
	ageMin: z.number().int().min(ACTIVITY_AGE_MIN).max(ACTIVITY_AGE_MAX).nullable(),
	ageMax: z.number().int().min(ACTIVITY_AGE_MIN).max(ACTIVITY_AGE_MAX).nullable(),
	source: z.enum(SOURCES).optional(),
	gradeLevel: z.enum(GRADE_LEVELS).nullable().optional(),
	subcategory: z.string().max(ACTIVITY_SUBCATEGORY_MAX).nullable().optional(),
	description: z.string().max(ACTIVITY_DESCRIPTION_MAX).nullable().optional(),
	dailyLimit: z.number().int().min(DAILY_LIMIT_MIN).max(DAILY_LIMIT_MAX).nullable().optional(),
	nameKana: z.string().max(ACTIVITY_NAME_FIELD_MAX).nullable().optional(),
	nameKanji: z.string().max(ACTIVITY_NAME_FIELD_MAX).nullable().optional(),
	triggerHint: z.string().max(ACTIVITY_TRIGGER_HINT_MAX).nullable().optional(),
});

export const updateActivitySchema = createActivitySchema.partial();

/**
 * #3463 item1/item4: dailyLimit を `[0, 99]` の整数 or null に正規化する (import 境界 + server clamp 共用)。
 * form action の zod (`min(0).max(99)`) は form 経路限定で、改竄/破損 ZIP 復元や API 直叩きの NaN/負値/
 * 巨大値/非整数を守らない。本 sanitizer を import-service と +page.server.ts の両境界で適用し default-deny 化する。
 *
 * dailyLimit semantics (`activity-log-service.ts` enforcement): `null=1回 (安全既定)` / `0=無制限 (最 permissive)` /
 * `N=N回`。下限外 (負値) は改竄/破損由来の不正入力であり、最 permissive な 0 (無制限) へ昇格させると
 * default-allow になる。よって負値は安全既定の null (=1回) に倒す。ユーザが明示入力した 0 は無制限として保持し、
 * 上限超は 99 へ丸める (DAILY_LIMIT_MIN..MAX の範囲内のみ trunc clamp)。
 */
export function sanitizeDailyLimit(raw: unknown): number | null {
	if (raw == null || raw === '') return null;
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(n)) return null;
	// 下限外 (負値) は不正入力 → 最 permissive な無制限 (0) への昇格を避け安全既定 null (=1回) に倒す。
	// trunc 前に判定し、-0.5 等が -0 (=0=無制限) に丸まるのを防ぐ。
	if (n < DAILY_LIMIT_MIN) return null;
	return Math.min(DAILY_LIMIT_MAX, Math.trunc(n));
}

/**
 * #3463 item1: 読み仮名 / 漢字表記を max 50 char に切詰める (import 境界)。巨大 nameKana/nameKanji 流入防止。
 */
export function sanitizeActivityNameField(raw: unknown): string | null {
	if (raw == null) return null;
	const s = String(raw);
	return s.length > ACTIVITY_NAME_FIELD_MAX ? s.slice(0, ACTIVITY_NAME_FIELD_MAX) : s;
}

export const recordActivitySchema = z.object({
	childId: childIdSchema,
	activityId: activityIdSchema,
});

export const activityLogsQuerySchema = z.object({
	childId: childIdSchema,
	period: z.enum(['week', 'month', 'year']).default('week'),
	from: z.string().optional(),
	to: z.string().optional(),
});

export const activitiesQuerySchema = z.object({
	childId: childIdSchema.optional(),
	categoryId: categoryIdSchema.optional(),
	includeHidden: z
		.string()
		.transform((v) => v === 'true')
		.optional(),
});

/** 漢字表記に切り替える年齢閾値（小学1年生以上） */
export const KANJI_AGE_THRESHOLD = 6;

/** 子供の年齢に応じた活動の表示名を返す */
export function getActivityDisplayName(
	activity: { name: string; nameKana?: string | null; nameKanji?: string | null },
	childAge: number,
): string {
	if (childAge >= KANJI_AGE_THRESHOLD && activity.nameKanji) {
		return activity.nameKanji;
	}
	if (childAge < KANJI_AGE_THRESHOLD && activity.nameKana) {
		return activity.nameKana;
	}
	return activity.name;
}

/** 親（大人）向けの表示名: 漢字表記を優先 */
export function getActivityDisplayNameForAdult(activity: {
	name: string;
	nameKanji?: string | null;
}): string {
	return activity.nameKanji || activity.name;
}

/** Calculate streak bonus: min(consecutiveDays - 1, 10) */
export function calcStreakBonus(consecutiveDays: number): number {
	if (consecutiveDays < 2) return 0;
	return Math.min(consecutiveDays - 1, 10);
}

/** Get today's date in YYYY-MM-DD format (JST) */
// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { todayDateJST as todayDate } from '$lib/domain/date-utils';

/** Cancel window in milliseconds (5 seconds) */
export const CANCEL_WINDOW_MS = 5000;

// ============================================================
// 活動習熟レベル (Activity Mastery)
// ============================================================

/** 累積回数 → レベル対応テーブル（対数的成長） */
export const MASTERY_LEVEL_TABLE: ReadonlyArray<{ minCount: number; level: number }> = [
	{ minCount: 0, level: 1 },
	{ minCount: 5, level: 2 },
	{ minCount: 10, level: 3 },
	{ minCount: 20, level: 4 },
	{ minCount: 30, level: 5 },
	{ minCount: 50, level: 6 },
	{ minCount: 70, level: 7 },
	{ minCount: 100, level: 8 },
	{ minCount: 130, level: 9 },
	{ minCount: 170, level: 10 },
	{ minCount: 220, level: 11 },
	{ minCount: 280, level: 12 },
	{ minCount: 350, level: 13 },
	{ minCount: 430, level: 14 },
	{ minCount: 520, level: 15 },
	{ minCount: 620, level: 16 },
	{ minCount: 730, level: 17 },
	{ minCount: 850, level: 18 },
	{ minCount: 980, level: 19 },
	{ minCount: 1120, level: 20 },
	{ minCount: 1280, level: 21 },
	{ minCount: 1450, level: 22 },
	{ minCount: 1640, level: 23 },
	{ minCount: 1850, level: 24 },
	{ minCount: 2080, level: 25 },
	{ minCount: 2330, level: 26 },
	{ minCount: 2600, level: 27 },
	{ minCount: 2900, level: 28 },
	{ minCount: 3220, level: 29 },
	{ minCount: 3570, level: 30 },
	{ minCount: 3950, level: 31 },
	{ minCount: 4360, level: 32 },
	{ minCount: 4800, level: 33 },
	{ minCount: 5270, level: 34 },
	{ minCount: 5770, level: 35 },
	{ minCount: 6300, level: 36 },
	{ minCount: 6860, level: 37 },
	{ minCount: 7450, level: 38 },
	{ minCount: 8070, level: 39 },
	{ minCount: 8720, level: 40 },
	{ minCount: 9999, level: 99 },
];

/** 累積回数からレベルを算出 */
export function calcMasteryLevel(totalCount: number): number {
	const entry = [...MASTERY_LEVEL_TABLE].reverse().find((e) => totalCount >= e.minCount);
	return Math.min(entry?.level ?? 1, 99);
}

/** 次のレベルまでの必要回数（残り） */
export function countToNextMasteryLevel(totalCount: number): number {
	const currentLevel = calcMasteryLevel(totalCount);
	const nextEntry = MASTERY_LEVEL_TABLE.find((e) => e.level === currentLevel + 1);
	if (!nextEntry) return 0; // Lv99 (cap)
	return nextEntry.minCount - totalCount;
}

/** レベルに応じたポイントボーナス: floor(level / 5) */
export function calcMasteryBonus(level: number): number {
	return Math.floor(level / 5);
}

/** 節目レベル（派手な演出対象） */
export const MASTERY_MILESTONE_LEVELS = new Set([5, 10, 20, 30, 50, 99]);
