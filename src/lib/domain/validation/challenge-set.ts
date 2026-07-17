import { z } from 'zod';
// #3151 slice4 (ADR-0066): icon の値域は「grapheme 数」で判定する。grapheme 計数は activity /
// reward / checklist と同一実装 (countIconGraphemes) を共有し、値でなく述語を SSOT 化する
// (ADR-0066 原則 2)。
import { countIconGraphemes } from './activity';

// ============================================================
// challenge-set item 値域 SSOT (#3151 slice4 / ADR-0066)
// ============================================================
// domain Zod schema (本ファイル challengeSetItemSchema) と wire Valibot schema
// (src/lib/marketplace/schemas/challenge-set-schema.ts の ChallengeSetItemSchema) の両方が
// 本定数を参照する。値域 literal の二重定義は #3132 class (値域ドリフト blocker) の root class の
// ため禁止。domain⊆wire 包含は tests/unit/architecture/schema-range-ssot.test.ts が boundary
// probe で機械表明する。
//
// challenge-set は #3195/#3227 で marketplace 取込型から外れ、admin/challenges は自動生成
// チャレンジを閲覧する読み取り専用ビューである (親の手動作成フォームは撤去済)。よって checklist
// (slice3) のような admin authoring 経路の validator 差し替えは存在しない。本 domain validator の
// 役割は (1) 値域 SSOT の正準定義 = wire schema が本定数を import し literal 二重定義を排除する、
// (2) fitness probe の domain oracle = wire schema と同一境界で受理/拒否することを cross-assert
// することで「wire が本定数を離れて literal を直書きする再ドリフト」を CI で検出する、の 2 点。
// import 経路 (marketplace preset JSON / export round-trip) は wire schema が唯一の runtime
// validator であり、本 domain schema はその値域が SSOT 定数と一致し続けることを保証する。

export const CHALLENGE_TITLE_MIN = 1;
export const CHALLENGE_TITLE_MAX = 100;
export const CHALLENGE_DESCRIPTION_MIN = 1;
export const CHALLENGE_DESCRIPTION_MAX = 500;
export const CHALLENGE_DURATION_DAYS_MIN = 1;
export const CHALLENGE_DURATION_DAYS_MAX = 90;
export const CHALLENGE_BASE_TARGET_MIN = 1;
export const CHALLENGE_BASE_TARGET_MAX = 1000;
export const CHALLENGE_REWARD_POINTS_MIN = 0;
export const CHALLENGE_REWARD_POINTS_MAX = 10000;
export const CHALLENGE_ICON_MIN_GRAPHEMES = 1;
export const CHALLENGE_ICON_MAX_GRAPHEMES = 2;

/**
 * 'MM-DD' (例: '03-03' = ひな祭り) 形式の正規表現。毎年同月日に開催される年間行事の論理表現。
 * domain / wire 両 schema が本定数を共有し、monthDay format の二重定義を排除する (#3151 slice4)。
 */
export const CHALLENGE_MONTH_DAY_REGEX = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * challenge item icon 値域 (1〜2 grapheme) 判定。domain Zod refine と wire Valibot check の
 * 共有 oracle (#3151 slice4)。旧 wire 側 `maxLength(20)` (UTF-16 units 基準) は ZWJ 連結絵文字
 * 2 個 (👨‍👩‍👧‍👦👨‍👩‍👧‍👦 = 22 units) を弾き (往復不能)、逆に絵文字 3 個以上 (🎁🎈🎀 = 6 units) を受理して
 * いた (単一〜少数の絵文字という意図に反する)。grapheme 判定への統一で「1〜2 個の絵文字」という
 * 意図を表現方式ごと SSOT 化し、activity / reward / checklist と同一境界に揃える。
 */
export function isValidChallengeIcon(val: string): boolean {
	const count = countIconGraphemes(val);
	return count >= CHALLENGE_ICON_MIN_GRAPHEMES && count <= CHALLENGE_ICON_MAX_GRAPHEMES;
}

/**
 * challenge-set item の domain validator (SSOT)。
 *
 * wire round-trip の 1 item (`ChallengeSetItemSchema`) と同一 shape (title / description /
 * monthDay / durationDays / baseTarget / rewardPoints / icon)。値域定数 / icon 述語 / monthDay
 * regex は上記 SSOT を参照し、wire schema と同一境界で受理/拒否する。
 *
 * 注: categoryId は「意味的カテゴリ enum」(picklist、$lib/domain/categories.ts SSOT) であり値域
 * ではないため本 domain range validator の対象外。wire schema が picklist として検証する
 * (SSOT はカテゴリ側に既存)。
 */
export const challengeSetItemSchema = z.object({
	title: z.string().min(CHALLENGE_TITLE_MIN).max(CHALLENGE_TITLE_MAX),
	description: z.string().min(CHALLENGE_DESCRIPTION_MIN).max(CHALLENGE_DESCRIPTION_MAX),
	monthDay: z.string().regex(CHALLENGE_MONTH_DAY_REGEX),
	durationDays: z.number().int().min(CHALLENGE_DURATION_DAYS_MIN).max(CHALLENGE_DURATION_DAYS_MAX),
	baseTarget: z.number().int().min(CHALLENGE_BASE_TARGET_MIN).max(CHALLENGE_BASE_TARGET_MAX),
	rewardPoints: z.number().int().min(CHALLENGE_REWARD_POINTS_MIN).max(CHALLENGE_REWARD_POINTS_MAX),
	icon: z
		.string()
		.min(1)
		.refine(isValidChallengeIcon, { message: 'アイコンは1〜2つの絵文字で指定してください' }),
});
