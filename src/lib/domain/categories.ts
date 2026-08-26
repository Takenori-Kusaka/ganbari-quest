// src/lib/domain/categories.ts
// カテゴリ id↔code↔表示メタの SSOT (#3607)。
//
// terms.ts atom (ADR-0045) / CONCEPT_ICONS (#2899) / CSS 3 層トークン (ADR-0042) と同型の
// 「as const オブジェクト + 派生型 + satisfies 網羅性」パターン。カテゴリを追加するときは
// 本ファイルの CATEGORIES に 1 エントリ追記するだけで、全消費側 (valibot picklist / literal
// union 型 / id↔code マップ / Record<CategoryCode, ...> 消費側) にコンパイル時伝播する。
// 網羅性の機械検証は tests/unit/domain/categories.test.ts (AC4)。
//
// 設計原則:
//   - **code (string) が正** — DSQL greenfield schema は categories(code) 自然キーへの論理 FK
//     (text)。数値 1-5 は marketplace payload / legacy wire / sqlite categories.id の互換投影
//     (`legacyNumericId`) として保持する。
//   - branded `CategoryId` (src/lib/domain/ids.ts、opaque string) とは責務が別:
//     ids.ts = エンティティ参照 (取り違え検出) / 本ファイル = 意味的 enum (値域と表示メタ)。
//   - color / accent は DB categories テーブル (create-tables.ts) に seed される master 表示メタ
//     のため SSOT に含める (create-tables.ts と旧 CATEGORY_DEFS の hex 二重定義を解消)。
//     export-service.ts の独自 palette は歴史的に別値であり、挙動不変のためローカル維持。
//
// 本モジュールは依存ゼロの pure module に保つこと — create-tables.ts が相対 import で参照し、
// その先の scripts/migrate-local.ts (tsx 直接実行) は $lib alias を解決できないため、
// ここに $lib import を追加すると NUC migrate が壊れる。

interface CategoryMeta {
	/** sqlite categories.id / marketplace challenge-set payload の数値 id (legacy wire 互換投影) */
	readonly legacyNumericId: number;
	/** 日本語表示名 (DB categories.name に seed。子供画面表示はひらがな) */
	readonly name: string;
	/** カテゴリアイコン (DB categories.icon に seed) */
	readonly icon: string;
	/** master 表示色 (DB categories.color に seed) */
	readonly color: string;
	/** アクセント色 (アプリ UI の強調表示用、DB には seed しない) */
	readonly accent: string;
}

export const CATEGORIES = {
	undou: { legacyNumericId: 1, name: 'うんどう', icon: '🏃', color: '#FF6B6B', accent: '#D32F2F' },
	benkyou: {
		legacyNumericId: 2,
		name: 'べんきょう',
		icon: '📚',
		color: '#4ECDC4',
		accent: '#00897B',
	},
	seikatsu: {
		legacyNumericId: 3,
		name: 'せいかつ',
		icon: '🏠',
		color: '#FFE66D',
		accent: '#F9A825',
	},
	kouryuu: {
		legacyNumericId: 4,
		name: 'こうりゅう',
		icon: '🤝',
		color: '#A8E6CF',
		accent: '#2E7D32',
	},
	souzou: { legacyNumericId: 5, name: 'そうぞう', icon: '🎨', color: '#DDA0DD', accent: '#7B1FA2' },
} as const satisfies Record<string, CategoryMeta>;

/** カテゴリコード union: 'undou' | 'benkyou' | 'seikatsu' | 'kouryuu' | 'souzou' */
export type CategoryCode = keyof typeof CATEGORIES;
/** 日本語表示名 union: 'うんどう' | 'べんきょう' | ... */
export type CategoryName = (typeof CATEGORIES)[CategoryCode]['name'];
/** legacy 数値 id union: 1 | 2 | 3 | 4 | 5 (marketplace payload / sqlite categories.id) */
export type CategoryNumericId = (typeof CATEGORIES)[CategoryCode]['legacyNumericId'];

/** 全カテゴリコード (定義順 = legacyNumericId 昇順) */
export const CATEGORY_CODES = Object.keys(CATEGORIES) as readonly CategoryCode[];

/**
 * 全カテゴリの日本語表示名 (定義順)。**文言で 5 カテゴリを列挙するときは必ずここから作る** (#4512)。
 *
 * ページガイドが実在しない「おてつだい」を挙げ「こうりゅう」を落としていた
 * (labels.ts 内でも別の箇所は正しく列挙しており、文言どうしが矛盾していた)。
 * 列挙を手で書くと、カテゴリを増減したときに文言だけが取り残される。
 */
export const CATEGORY_NAMES: readonly CategoryName[] = CATEGORY_CODES.map(
	(code) => CATEGORIES[code].name,
);

/** 5 カテゴリを「・」区切りで並べた表示用文字列 (例: 「うんどう・べんきょう・…」)。 */
export const CATEGORY_NAME_LIST = CATEGORY_NAMES.join('・');

/** 全 legacy 数値 id (定義順)。valibot `v.picklist(CATEGORY_NUMERIC_IDS)` 等の値域 SSOT */
export const CATEGORY_NUMERIC_IDS = CATEGORY_CODES.map(
	(code) => CATEGORIES[code].legacyNumericId,
) as readonly CategoryNumericId[];

/** legacy 数値 id → code (型レベル total: schema 検証済みの CategoryNumericId で索引する) */
export const CATEGORY_ID_TO_CODE = Object.fromEntries(
	CATEGORY_CODES.map((code) => [CATEGORIES[code].legacyNumericId, code]),
) as Record<CategoryNumericId, CategoryCode>;

/** code → legacy 数値 id (型レベル total) */
export const CATEGORY_CODE_TO_ID = Object.fromEntries(
	CATEGORY_CODES.map((code) => [code, CATEGORIES[code].legacyNumericId]),
) as Record<CategoryCode, CategoryNumericId>;

const ID_TO_CODE_LOOKUP = new Map<number, CategoryCode>(
	CATEGORY_CODES.map((code) => [CATEGORIES[code].legacyNumericId, code]),
);
const CODE_LOOKUP = new Map<string, CategoryNumericId>(
	CATEGORY_CODES.map((code) => [code, CATEGORIES[code].legacyNumericId]),
);

/**
 * 未検証の境界入力 (branded CategoryId 文字列 / 外部 payload の数値) から code を引く。
 * 検証済み `CategoryNumericId` を持っている場合は `CATEGORY_ID_TO_CODE` の total 索引を使うこと。
 */
export function toCategoryCode(id: number | string): CategoryCode | undefined {
	return ID_TO_CODE_LOOKUP.get(Number(id));
}

/**
 * 未検証の境界入力 (import ファイル等の categoryCode 文字列) から legacy 数値 id を引く。
 * 検証済み `CategoryCode` を持っている場合は `CATEGORY_CODE_TO_ID` の total 索引を使うこと。
 */
export function toLegacyCategoryId(code: string): CategoryNumericId | undefined {
	return CODE_LOOKUP.get(code);
}
