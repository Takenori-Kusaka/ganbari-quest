// src/lib/domain/ids.ts
// 主要エンティティ id の branded type SSOT (#3575 PR-R0、EPIC #3424 / PO 決裁 2026-07-04)。
//
// DSQL 移管 (§11.2) で id は uuid ベースの string になる。repo interface / service / route の
// id 型を素の string でなく branded string にすることで:
//   - ChildId と ActivityId の取り違え (ADR-0055 child-scope 越境の関心事) をコンパイル時に検出
//   - 「id は opaque token」を型で明文化
//
// ⚠️ 数値意味依存の実態 (#3581 ① で claim 是正、2026-07-15 再調査):
//   - **service/domain 層**: hashSeed (child-challenge-service.ts、childId 文字列を hash) の
//     1 点のみ — こちらは opaque string でも成立する (文字列 hash であり数値解釈しない)。
//   - **dynamodb / demo backend 内部**: `Number(childId)` 等の数値変換・数値 key 合成が
//     多数残存する (activity-mastery-repo / activity-pref-repo ほか)。これらの backend は
//     integer 由来 id ('903' 等) 前提の legacy 実装で、uuid id を渡すと NaN key になる。
//     本番 (dsql) / NUC (pglite) は cutover 済のため実害は demo fixture / dynamodb 撤去
//     (#3438) までの残債扱い。**uuid id を dynamodb/demo backend に流してはならない**。
//
// 値の実態は backend 依存の opaque string:
//   - dsql / pglite: uuid v4 (gen_random_uuid)
//   - sqlite (legacy、#3438 撤去まで): 既存 integer PK の 10 進文字列 (repo 境界で String()/Number() 変換)
//   - demo: '903' 等の数値文字列 fixture (ADR-0048 stateless、uuid 化しない)
// よって as* コンストラクタは number も受ける (境界変換用)。branded は compile-time のみで
// runtime コストゼロ。trust 境界 (route param / cookie / form) での形式 validation は
// #3581 ② の scope (pg 層の findChildById uuid guard は #3709 で導入済、pg-uuid.ts)。

declare const idBrand: unique symbol;
type Branded<T, B extends string> = T & { readonly [idBrand]: B };

/** 子供 id (children.child_id)。 */
export type ChildId = Branded<string, 'ChildId'>;
/** 活動 id (child_activities.activity_id)。 */
export type ActivityId = Branded<string, 'ActivityId'>;
/**
 * カテゴリ id (categories.code への論理 FK)。
 * 責務はエンティティ参照 (opaque token、取り違え検出) のみ。カテゴリの値域・code↔数値 id
 * 対応・表示メタ (意味的 enum) は $lib/domain/categories.ts が SSOT (#3607)。
 */
export type CategoryId = Branded<string, 'CategoryId'>;

/** 境界 (route param / cookie / 旧 integer PK) からの取り込み。検証はしない (opaque)。 */
export const asChildId = (v: string | number): ChildId => String(v) as ChildId;
export const asActivityId = (v: string | number): ActivityId => String(v) as ActivityId;
export const asCategoryId = (v: string | number): CategoryId => String(v) as CategoryId;
