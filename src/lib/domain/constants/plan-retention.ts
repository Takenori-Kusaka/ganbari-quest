// src/lib/domain/constants/plan-retention.ts
// プラン別「履歴保持日数」の値 SSOT (#4477)。
//
// 背景:
//   保持日数は長らく `plan-limit-service.ts` の PLAN_LIMITS[tier].historyRetentionDays と
//   labels.ts / plan-features.ts の表示文字列 (「90日間の履歴保持」等) で二重管理されていた。
//   前者を変えても LP 料金表・アプリの機能リストは古い日数のまま残り、顧客に見える価格表が
//   実装と食い違う (ADR-0013 LP truth 違反)。本ファイルを値の唯一の定義とし、
//   実装 (plan-limit-service) と表示 (terms.ts → labels.ts → LP) の両方がここから引く。
//
// 置き場所の判断:
//   labels.ts / terms.ts は domain 層であり `$lib/server/**` を import できない。
//   一方 plan-limit-service.ts は server 専用 module。したがって値を domain leaf に降ろし、
//   plan-limit-service 側がここから import する (型 SSOT を domain leaf に降ろした #3963 と同型)。
//
// 関連: ADR-0013 (LP 文言は実装の事実を SSOT とする) / ADR-0045 (terms.ts atom / labels.ts compound)
//       ADR-0049 (プラン別履歴保持期間ポリシー) / 08-データベース設計書 §6.5

import type { PlanTier } from './plan-tier';

/**
 * プラン別の履歴保持日数。`null` = 無期限 (物理削除しない)。
 *
 * **この 3 つの数値がプロダクト全体の SSOT**。表示文字列側に数値を複製しないこと。
 *
 * 複製を検出する CI script は無い (機械強制は無い)。追随は
 * `tests/unit/domain/plan-retention-ssot.test.ts` が「本定数から組み立てた文字列と
 * 表示側が一致するか」で検証する — 表示側に数値を直書きすると、本定数を変えた瞬間に
 * 同 test が落ちる。unit test が見ていない表示経路は、レビューで担保する。
 */
export const PLAN_HISTORY_RETENTION_DAYS: Record<PlanTier, number | null> = {
	free: 90,
	standard: 365,
	family: null,
};

/**
 * 保持日数を表示用の期間文字列にする。
 *
 * - `null` → `無期限`
 * - 365 の倍数 → `N年` (365 → `1年`)
 * - それ以外 → `N日`
 *
 * @param days 保持日数 (null = 無期限)
 * @param options.spaced 数値と単位の間に半角スペースを入れる (LP 本文の組版に合わせる)
 */
export function formatRetentionPeriod(days: number | null, options?: { spaced?: boolean }): string {
	if (days === null) return '無期限';
	const sep = options?.spaced ? ' ' : '';
	if (days % 365 === 0) return `${days / 365}${sep}年`;
	return `${days}${sep}日`;
}
