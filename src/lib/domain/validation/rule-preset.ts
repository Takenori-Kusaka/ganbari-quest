import * as v from 'valibot';
// #3151 slice4 (ADR-0066): icon の値域は「grapheme 数」で判定する。grapheme 計数は activity /
// reward / checklist と同一実装 (countIconGraphemes) を共有し、値でなく述語を SSOT 化する
// (ADR-0066 原則 2)。
import { countIconGraphemes } from './activity';

// ============================================================
// rule-preset item 値域 SSOT (#3151 slice4 / ADR-0066)
// ============================================================
// domain Valibot schema (本ファイル rulePresetItemSchema) と wire Valibot schema
// (src/lib/marketplace/schemas/rule-preset-schema.ts の RulePresetItemSchema) の両方が本定数を
// 参照する。値域 literal の二重定義は #3132 class (値域ドリフト blocker) の root class のため禁止。
// domain⊆wire 包含は tests/unit/architecture/schema-range-ssot.test.ts が boundary probe で
// 機械表明する。
//
// rule-preset は settings サブ機能 (`/admin/settings/rules`) の一機能であり、画面は取込済 bonus
// preset の ON/OFF トグル + 削除 + `?import=` 即取込のみで、ユーザーが任意値の rule を手入力する
// authoring フォームは存在しない (取込元は marketplace preset JSON、wire schema 検証済)。よって
// checklist (slice3) のような authoring 経路の validator 差し替えは存在しない。本 domain
// validator の役割は (1) 値域 SSOT の正準定義 = wire schema が本定数を import し literal 二重定義を
// 排除する、(2) fitness probe の domain oracle = wire schema と同一境界で受理/拒否することを
// cross-assert し「wire が本定数を離れて literal を直書きする再ドリフト」を CI で検出する、の 2 点。

export const RULE_TITLE_MIN = 1;
export const RULE_TITLE_MAX = 100;
export const RULE_DESCRIPTION_MIN = 1;
export const RULE_DESCRIPTION_MAX = 500;
/** pointCost / pointBonus 共通の下限 (0 = 無償)。ポイント経済設計上いずれも非負 */
export const RULE_POINT_MIN = 0;
/** pointCost / pointBonus 共通の上限。reward-set (REWARD_POINTS_MAX) と同じポイント経済上限 */
export const RULE_POINT_MAX = 10000;
export const RULE_ICON_MIN_GRAPHEMES = 1;
export const RULE_ICON_MAX_GRAPHEMES = 2;

/**
 * rule item icon 値域 (1〜2 grapheme) 判定。domain / wire 両 Valibot check の共有 oracle
 * (#3151 slice4)。旧 wire 側 `maxLength(20)` (UTF-16 units 基準) は ZWJ 連結絵文字 2 個 (22 units)
 * を弾き、逆に絵文字 3 個以上 (🎁🎈🎀 = 6 units) を受理していた。grapheme 判定への統一で
 * 「1〜2 個の絵文字」という意図を表現方式ごと SSOT 化し、activity / reward / checklist と同一
 * 境界に揃える。
 */
export function isValidRuleIcon(val: string): boolean {
	const count = countIconGraphemes(val);
	return count >= RULE_ICON_MIN_GRAPHEMES && count <= RULE_ICON_MAX_GRAPHEMES;
}

// ============================================================
// field 単位の Valibot schema (domain / wire 共有 SSOT、#3852 Phase B-2 / EPIC #3151 選択肢 B)
// ============================================================
// 旧: 同じ title/description/icon/pointCost/pointBonus の shape を domain Zod と wire Valibot
// (rule-preset-schema.ts) で 2 回宣言 (slice4 では値域「定数」だけを共有し、field「schema 構造」は
// 依然 2 重定義だった)。新: field pipe を本節に 1 回だけ定義し、domain object (下記
// rulePresetItemSchema) と wire object の双方が import して組み立てる。構造の二重定義を排し、
// 境界値の再ドリフト (#3132 class) を構造的に不可能にする。activity / reward / checklist と同型。

/** rule title (1〜100 文字) */
export const ruleTitleSchema = v.pipe(
	v.string('title は文字列で指定してください'),
	v.minLength(RULE_TITLE_MIN, 'title は必須です'),
	v.maxLength(RULE_TITLE_MAX, `title は ${RULE_TITLE_MAX} 文字以内で指定してください`),
);

/** rule description (1〜500 文字) */
export const ruleDescriptionSchema = v.pipe(
	v.string('description は文字列で指定してください'),
	v.minLength(RULE_DESCRIPTION_MIN, 'description は必須です'),
	v.maxLength(
		RULE_DESCRIPTION_MAX,
		`description は ${RULE_DESCRIPTION_MAX} 文字以内で指定してください`,
	),
);

/** rule item icon (1〜2 grapheme の絵文字)。isValidRuleIcon を共有 oracle に判定 (#3151) */
export const ruleIconSchema = v.pipe(
	v.string(),
	v.minLength(1, 'icon は必須です'),
	v.check(isValidRuleIcon, 'icon は 1〜2 個の絵文字で指定してください'),
);

/**
 * pointCost / pointBonus 共通の値域 schema (0〜10000 の整数)。両 field は同一値域 (RULE_POINT_*) の
 * ため単一 field schema を共有する (reward-set の rewardPointsSchema と同型の field 共有原則)。
 * object 側で `v.optional(...)` により省略可を表現する。
 */
export const rulePointSchema = v.pipe(
	v.number('ポイントは数値で指定してください'),
	v.integer('ポイントは整数で指定してください'),
	v.minValue(RULE_POINT_MIN, `ポイントは ${RULE_POINT_MIN} 以上で指定してください`),
	v.maxValue(RULE_POINT_MAX, `ポイントは ${RULE_POINT_MAX} 以下で指定してください`),
);

/**
 * rule-preset item の domain validator (SSOT)。
 *
 * wire round-trip の 1 item (`RulePresetItemSchema`) と同一 shape (title / description / icon /
 * pointCost? / pointBonus?)。値域定数 / icon 述語は上記 SSOT を参照し、wire schema と同一境界で
 * 受理/拒否する。ruleType は item ではなく payload レベルの picklist (RULE_TYPES) のため本 item
 * validator の対象外。
 */
export const rulePresetItemSchema = v.object({
	title: ruleTitleSchema,
	description: ruleDescriptionSchema,
	icon: ruleIconSchema,
	pointCost: v.optional(rulePointSchema),
	pointBonus: v.optional(rulePointSchema),
});
