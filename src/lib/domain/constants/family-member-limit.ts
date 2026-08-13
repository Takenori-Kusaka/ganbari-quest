// src/lib/domain/constants/family-member-limit.ts
// 家族メンバー (招待による保護者アカウント) のプラン別上限の値 SSOT (#4500)。
//
// 背景:
//   上限 4 は `plan-limit-service.ts` (server 専用 module) にだけ存在し、顧客に見える
//   文言側 (labels.ts / LP / FAQ / パンフ) は「4人まで」を文字列で 10 箇所複製していた。
//   複製された数値は **owner 込みの合計**であるにもかかわらず「**招待**は 4 人まで」と
//   招待人数として訴求され、実際に招待できる 3 人に対して 1 人分の過大表示になっていた
//   (#4500 / ADR-0013 LP truth 違反)。値を domain leaf に降ろし、表示側は terms.ts の
//   atom (`FAMILY_MEMBER_LIMIT_TERMS`) 経由でここから引くことで、数値の複製と
//   「合計 / 招待可能数」の取り違えを断つ。
//
// 置き場所の判断:
//   labels.ts / terms.ts は domain 層であり `$lib/server/**` を import できない。
//   一方 plan-limit-service.ts は server 専用 module。したがって値を domain leaf に降ろし、
//   server 側がここから import する (退会猶予を `deletion-grace.ts` に降ろした #4496 と同型)。
//
// 関連: ADR-0013 (LP 文言は実装の事実を SSOT とする) / ADR-0045 (terms.ts atom / labels.ts compound)
//       #1111 (プラン別上限)

import type { PlanTier } from './plan-tier';

/**
 * 家族グループに所属できるメンバー数の上限。**owner を含む合計**。`null` = 無制限。
 *
 * **この 3 つの数値がプロダクト全体の SSOT**。表示文字列側に数値を複製しないこと。
 *
 * - `free: 1` … owner のみ。招待そのものができない
 * - `standard: 4` … owner + 招待 3 人 (核家族想定、#1111)
 * - `family: null` … 無制限
 *
 * 複製の検出は `tests/unit/domain/family-member-limit-terminology.test.ts` が
 * 「本定数から組み立てた文字列と表示側が一致するか」で行う。
 */
export const FAMILY_MEMBER_LIMIT: Record<PlanTier, number | null> = {
	free: 1,
	standard: 4,
	family: null,
};

/**
 * 合計上限から**招待できる人数**を求める。owner の 1 枠を差し引く。
 *
 * 「合計 4 人」と「招待 4 人」を同一視したことが #4500 の欠陥そのものなので、
 * 変換をここ 1 箇所に閉じ、表示側で引き算をさせない。
 *
 * @param total owner を含む合計上限
 */
export function invitableFrom(total: number): number {
	return Math.max(0, total - 1);
}

/**
 * 人数を表示用の文字列にする。
 *
 * @param count 人数
 * @param options.spaced 数値と単位の間に半角スペースを入れる (LP 本文の組版に合わせる)
 */
export function formatMemberCount(count: number, options?: { spaced?: boolean }): string {
	return `${count}${options?.spaced ? ' ' : ''}人`;
}
