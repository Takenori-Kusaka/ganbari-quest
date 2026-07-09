// src/lib/domain/ids.ts
// 主要エンティティ id の branded type SSOT (#3575 PR-R0、EPIC #3424 / PO 決裁 2026-07-04)。
//
// DSQL 移管 (§11.2) で id は uuid ベースの string になる。repo interface / service / route の
// id 型を素の string でなく branded string にすることで:
//   - ChildId と ActivityId の取り違え (ADR-0055 child-scope 越境の関心事) をコンパイル時に検出
//   - 「id は opaque token」(2026-07-04 調査: 数値意味依存は hashSeed 1 点のみ) を型で明文化
//
// 値の実態は backend 依存の opaque string:
//   - dsql: uuid v4 (gen_random_uuid)
//   - sqlite (NUC cutover §12.2 まで): 既存 integer PK の 10 進文字列 (repo 境界で String()/Number() 変換)
//   - demo: '903' 等の数値文字列 fixture (ADR-0048 stateless、uuid 化しない)
// よって as* コンストラクタは number も受ける (境界変換用)。branded は compile-time のみで
// runtime コストゼロ。

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
