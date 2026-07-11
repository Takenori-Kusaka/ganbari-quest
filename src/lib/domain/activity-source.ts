// src/lib/domain/activity-source.ts
// 活動 `source` 列挙値の意味論 SSOT (#3669)
//
// 背景: producer (作成経路) と consumer (quota / カウンタ) が三者三様の source 値
// ('seed' 保存 / 'custom' 集計 / 'parent' 表示) を前提にして drift し、free プランの
// 活動数上限 (maxActivities=3) が全プランで実質未執行になっていた。本 module が
// 「どの経路が何を保存し、誰が何を数えるか」の単一定義点 (#3607 categories SSOT と
// 同じ `as const satisfies` パターン)。
//
// 経路別の source 値 (producer 4 経路):
//   - 手動作成 (admin UI 単体/一括追加、api/v1/activities): `custom` (quota 集計対象)
//   - marketplace 取込 (activity-import-service / cloud import): 未指定 → repo 既定 `seed`
//     (取込元は `sourcePresetId` で識別。プリセット取込は custom quota を消費しない)
//   - 初期 seed (seed.ts): `seed` / 年齢別カリキュラム: `curriculum`
//   - 兄弟 copy (copyActivitiesAcrossChildren): 元活動の source を保全
//     (custom の copy は custom のまま。copy による quota 迂回を防ぐ)
//
// 設計 doc: docs/design/data-model-resource-scope.md §4.1

export interface ActivitySourceDef {
	/** DB `child_activities.source` に保存される値 */
	readonly value: string;
	/** 親作成 quota (PLAN_LIMITS.maxActivities) / subscription カウンタの集計対象か */
	readonly countsTowardQuota: boolean;
	/** 意味論 (どの経路が保存するか) */
	readonly description: string;
}

export const ACTIVITY_SOURCES = {
	seed: {
		value: 'seed',
		countsTowardQuota: false,
		description: '初期 seed / marketplace 取込 / backup 復元 (schema default)',
	},
	curriculum: {
		value: 'curriculum',
		countsTowardQuota: false,
		description: '年齢別カリキュラムプリセット (seed.ts)',
	},
	custom: {
		value: 'custom',
		countsTowardQuota: true,
		description: '親が UI から手動作成 (単体追加 / 一括追加 / api/v1/activities)',
	},
} as const satisfies Record<string, ActivitySourceDef>;

export type ActivitySourceCode = keyof typeof ACTIVITY_SOURCES;

/** 親手動作成の正準 source 値。producer (admin add / bulkAdd / createActivity) はこれを保存する */
export const PARENT_CREATED_SOURCE = ACTIVITY_SOURCES.custom.value;

/**
 * 旧 wire 値 'parent'。DB には保存された実績が無い (insert 境界で drop されていた) が、
 * 旧クライアント / 既存 zod enum が受理するため、persist 前に `custom` へ正規化する。
 */
export const LEGACY_PARENT_SOURCE = 'parent';

/**
 * wire (createActivitySchema) が受理する source 値域。
 * `src/lib/domain/validation/activity.ts` の zod `z.enum(SOURCES)` から参照される。
 */
export const ACTIVITY_SOURCE_WIRE_VALUES = ['seed', 'curriculum', 'custom', 'parent'] as const;

export type ActivitySourceWireValue = (typeof ACTIVITY_SOURCE_WIRE_VALUES)[number];

/**
 * 親手動作成経路の source 正規化 (producer 単一強制点、ADR-0061 push-down)。
 * 未指定 / legacy 'parent' は正準 `custom` に倒す。明示された既知値はそのまま通す
 * (内部経路が seed/curriculum を意図的に指定するケースを壊さない)。
 */
export function normalizeParentCreatedSource(source: string | undefined): string {
	if (source === undefined || source === LEGACY_PARENT_SOURCE) return PARENT_CREATED_SOURCE;
	return source;
}

/**
 * quota (checkActivityLimit) / subscription カウンタ / downgrade archive が
 * 「親作成 (custom) 活動」として数える述語 (consumer 共通 SSOT)。
 * legacy 'parent' も防御的に数える (repo 直 write 等で将来混入しても課金境界を守る)。
 */
export function countsTowardActivityQuota(source: string): boolean {
	return source === PARENT_CREATED_SOURCE || source === LEGACY_PARENT_SOURCE;
}
