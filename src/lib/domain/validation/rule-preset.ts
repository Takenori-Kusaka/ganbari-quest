import { z } from 'zod';
// #3151 slice4 (ADR-0066): icon の値域は「grapheme 数」で判定する。grapheme 計数は activity /
// reward / checklist と同一実装 (countIconGraphemes) を共有し、値でなく述語を SSOT 化する
// (ADR-0066 原則 2)。
import { countIconGraphemes } from './activity';

// ============================================================
// rule-preset item 値域 SSOT (#3151 slice4 / ADR-0066)
// ============================================================
// domain Zod schema (本ファイル rulePresetItemSchema) と wire Valibot schema
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
 * rule item icon 値域 (1〜2 grapheme) 判定。domain Zod refine と wire Valibot check の共有 oracle
 * (#3151 slice4)。旧 wire 側 `maxLength(20)` (UTF-16 units 基準) は ZWJ 連結絵文字 2 個 (22 units)
 * を弾き、逆に絵文字 3 個以上 (🎁🎈🎀 = 6 units) を受理していた。grapheme 判定への統一で
 * 「1〜2 個の絵文字」という意図を表現方式ごと SSOT 化し、activity / reward / checklist と同一
 * 境界に揃える。
 */
export function isValidRuleIcon(val: string): boolean {
	const count = countIconGraphemes(val);
	return count >= RULE_ICON_MIN_GRAPHEMES && count <= RULE_ICON_MAX_GRAPHEMES;
}

/**
 * rule-preset item の domain validator (SSOT)。
 *
 * wire round-trip の 1 item (`RulePresetItemSchema`) と同一 shape (title / description / icon /
 * pointCost? / pointBonus?)。値域定数 / icon 述語は上記 SSOT を参照し、wire schema と同一境界で
 * 受理/拒否する。ruleType は item ではなく payload レベルの picklist (RULE_TYPES) のため本 item
 * validator の対象外。
 */
export const rulePresetItemSchema = z.object({
	title: z.string().min(RULE_TITLE_MIN).max(RULE_TITLE_MAX),
	description: z.string().min(RULE_DESCRIPTION_MIN).max(RULE_DESCRIPTION_MAX),
	icon: z
		.string()
		.min(1)
		.refine(isValidRuleIcon, { message: 'アイコンは1〜2つの絵文字で指定してください' }),
	pointCost: z.number().int().min(RULE_POINT_MIN).max(RULE_POINT_MAX).optional(),
	pointBonus: z.number().int().min(RULE_POINT_MIN).max(RULE_POINT_MAX).optional(),
});
