import * as v from 'valibot';
import { ACTIVITY_SOURCE_WIRE_VALUES } from '$lib/domain/activity-source';
import {
	CATEGORY_CODES,
	CATEGORIES as CATEGORY_SSOT,
	type CategoryCode,
	type CategoryName,
} from '$lib/domain/categories';
import { asActivityId, asCategoryId, asChildId, type CategoryId } from '$lib/domain/ids';

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
// (v.picklist 用) の再 export。'parent' は legacy wire 値で persist 前に 'custom' へ正規化される。
export const SOURCES = ACTIVITY_SOURCE_WIRE_VALUES;

export type Source = (typeof SOURCES)[number];

// ============================================================
// 活動 値域 SSOT (#3151 / ADR-0066)
// ============================================================
// domain Valibot schema (本ファイル createActivitySchema) と wire Valibot schema
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
 * icon 値域 (1〜2 grapheme) 判定。domain / wire の Valibot check の共有 oracle (#3151 / #3852 Phase B-1)。
 * 旧 wire 側 maxLength(20) (UTF-16 units 基準) は ZWJ 連結絵文字 2 個 (22 units) を弾き
 * domain⊆wire を破っていたため、本関数への統一で値域を表現方式ごと SSOT 化した。
 */
export function isValidActivityIcon(val: string): boolean {
	const count = countIconGraphemes(val);
	return count >= ACTIVITY_ICON_MIN_GRAPHEMES && count <= ACTIVITY_ICON_MAX_GRAPHEMES;
}

// ============================================================
// field 単位の Valibot schema (domain / wire 共有 SSOT、#3852 Phase B-1 / EPIC #3151 選択肢 B)
// ============================================================
// 旧: 同じ name/icon/basePoints/age/gradeLevel/triggerHint/description の shape を domain Zod と
// wire Valibot (activity-pack-schema.ts) で 2 回宣言。新: field pipe を本節に 1 回だけ定義し、
// domain object (下記 createActivitySchema) と wire object の双方が import して組み立てる。
// 構造の二重定義を排し、境界値の再ドリフト (#3132 class) を構造的に不可能にする。special-reward
// (Phase B-0 / #3853) と同型。値域定数 (ACTIVITY_*) + 述語 (isValidActivityIcon) は本ファイルに維持。

/** 活動名 (1〜50 文字) */
export const activityNameSchema = v.pipe(
	v.string('活動名は文字列で指定してください'),
	v.minLength(ACTIVITY_NAME_MIN, '活動名は必須です'),
	v.maxLength(ACTIVITY_NAME_MAX, `活動名は ${ACTIVITY_NAME_MAX} 文字以内で指定してください`),
);

/** 活動アイコン (1〜2 grapheme の絵文字)。isValidActivityIcon を共有 oracle に判定 (#3151) */
export const activityIconSchema = v.pipe(
	v.string(),
	v.minLength(1, 'アイコンは必須です'),
	v.check(isValidActivityIcon, 'アイコンは1〜2つの絵文字で指定してください'),
);

/** 活動の基礎ポイント (1〜100 の整数) */
export const activityBasePointsSchema = v.pipe(
	v.number('basePoints は数値で指定してください'),
	v.integer('basePoints は整数で指定してください'),
	v.minValue(
		ACTIVITY_BASE_POINTS_MIN,
		`basePoints は ${ACTIVITY_BASE_POINTS_MIN} 以上で指定してください`,
	),
	v.maxValue(
		ACTIVITY_BASE_POINTS_MAX,
		`basePoints は ${ACTIVITY_BASE_POINTS_MAX} 以下で指定してください`,
	),
);

/**
 * 年齢境界 (0〜20 の整数)。`null` (年齢制限なし) は object 側で `v.nullable(activityAgeSchema)` で表現する。
 * ageMin / ageMax の両方が本 field schema を共有する。
 */
export const activityAgeSchema = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(ACTIVITY_AGE_MIN),
	v.maxValue(ACTIVITY_AGE_MAX),
);

/** 学年区分。`null` (未設定) は object 側で `v.nullable(...)` で表現する */
export const activityGradeLevelSchema = v.picklist(GRADE_LEVELS);

/** 「今日のおやくそく」推奨トリガーヒント (最大 30 文字) */
export const activityTriggerHintSchema = v.pipe(v.string(), v.maxLength(ACTIVITY_TRIGGER_HINT_MAX));

/** 活動説明 (最大 200 文字) */
export const activityDescriptionSchema = v.pipe(v.string(), v.maxLength(ACTIVITY_DESCRIPTION_MAX));

// id-schema.ts (Zod) 等価の局所 Valibot 版。query / body 由来の string と旧クライアント互換の number を
// 受け branded 化する。id-schema 全体の Valibot 化は activity/reward 以外の schema へ波及するため本 scope
// 外 (special-reward Phase B-0 と同方針で局所定義)。
const idLikeSchema = v.union([
	v.pipe(v.string(), v.minLength(1)),
	v.pipe(v.number(), v.integer(), v.minValue(1)),
]);
const childIdLikeSchema = v.pipe(
	idLikeSchema,
	v.transform((val) => asChildId(val)),
);
const activityIdLikeSchema = v.pipe(
	idLikeSchema,
	v.transform((val) => asActivityId(val)),
);
const categoryIdLikeSchema = v.pipe(
	idLikeSchema,
	v.transform((val) => asCategoryId(val)),
);

// ============================================================
// domain object schema (Valibot、#3852 Phase B-1)
// ============================================================

export const createActivitySchema = v.object({
	name: activityNameSchema,
	// #3575: id は opaque string。旧クライアント/テストの number も境界で as* 変換して受ける。
	// createActivitySchema の categoryId は idLike (min/positive) ではなく CATEGORY_DEFS 実在 check で
	// 妥当性を担保する (query 経路の categoryIdLikeSchema とは別軸)。
	categoryId: v.pipe(
		v.union([v.string(), v.number()]),
		v.transform((val) => asCategoryId(val)),
		v.check((val) => CATEGORY_DEFS.some((c) => c.id === val), 'カテゴリが不正です'),
	),
	icon: activityIconSchema,
	basePoints: activityBasePointsSchema,
	ageMin: v.nullable(activityAgeSchema),
	ageMax: v.nullable(activityAgeSchema),
	source: v.optional(v.picklist(SOURCES)),
	gradeLevel: v.optional(v.nullable(activityGradeLevelSchema)),
	subcategory: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(ACTIVITY_SUBCATEGORY_MAX)))),
	description: v.optional(v.nullable(activityDescriptionSchema)),
	dailyLimit: v.optional(
		v.nullable(
			v.pipe(v.number(), v.integer(), v.minValue(DAILY_LIMIT_MIN), v.maxValue(DAILY_LIMIT_MAX)),
		),
	),
	nameKana: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(ACTIVITY_NAME_FIELD_MAX)))),
	nameKanji: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(ACTIVITY_NAME_FIELD_MAX)))),
	triggerHint: v.optional(v.nullable(activityTriggerHintSchema)),
});

export const updateActivitySchema = v.partial(createActivitySchema);

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

export const recordActivitySchema = v.object({
	childId: childIdLikeSchema,
	activityId: activityIdLikeSchema,
});

export const activityLogsQuerySchema = v.object({
	childId: childIdLikeSchema,
	period: v.optional(v.picklist(['week', 'month', 'year']), 'week'),
	from: v.optional(v.string()),
	to: v.optional(v.string()),
});

export const activitiesQuerySchema = v.object({
	childId: v.optional(childIdLikeSchema),
	categoryId: v.optional(categoryIdLikeSchema),
	includeHidden: v.optional(
		v.pipe(
			v.string(),
			v.transform((val) => val === 'true'),
		),
	),
});

/** 漢字表記に切り替える年齢閾値（小学1年生以上） */
export const KANJI_AGE_THRESHOLD = 6;

/** 子供の年齢に応じた活動の表示名を返す */
/**
 * seed 由来で名前に漢字を含む活動の読み (#4690 / QM #4809)。
 * seed.ts に kana を足しても、既に seed 済みの DB (NUC / local) の activities / child_activities 行には
 * 追補経路 (name 一致で skip) では入らないため、表示時にここで補う。
 * seed.ts の「漢字を含む name + nameKana」の全組と一致することを
 * tests/unit/domain/seed-kanji-name-kana-4690.test.ts が固定する。
 */
export const SEED_KANJI_NAME_KANA: Readonly<Record<string, string>> = Object.freeze({
	水やりをする: 'みずやりをする',
});

export function getActivityDisplayName(
	activity: { name: string; nameKana?: string | null; nameKanji?: string | null },
	childAge: number,
): string {
	if (childAge >= KANJI_AGE_THRESHOLD && activity.nameKanji) {
		return activity.nameKanji;
	}
	if (childAge < KANJI_AGE_THRESHOLD) {
		const kana = activity.nameKana || SEED_KANJI_NAME_KANA[activity.name];
		if (kana) return kana;
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

/**
 * cancel 時に対称返金すべき mastery_bonus を、cancel 対象 log の記録で増えた mastery 総回数
 * (post-record count) から再構成する (#3787)。
 *
 * 記録時 (`prepareActivityRecord`) は「記録前 level」= `calcMasteryLevel(count - 1)` を基準に
 * `calcMasteryBonus` を付与する (mastery は per-record 付与)。cancel の point_ledger 相殺行も
 * 同一式で額を復元し、record→cancel cycle で mastery_bonus が balance に残らない (farming vector
 * 消滅)。latest record の cancel では付与額と厳密一致する (既存の mastery count 巻戻しと同精度)。
 */
export function calcMasteryBonusRefundOnCancel(postRecordCount: number): number {
	if (postRecordCount <= 0) return 0;
	return calcMasteryBonus(calcMasteryLevel(postRecordCount - 1));
}

/** 節目レベル（派手な演出対象） */
export const MASTERY_MILESTONE_LEVELS = new Set([5, 10, 20, 30, 50, 99]);
