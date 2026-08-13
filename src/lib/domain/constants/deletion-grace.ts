// src/lib/domain/constants/deletion-grace.ts
// 退会 (アカウント削除) のプラン別猶予日数の値 SSOT (#4496)。
//
// 背景:
//   猶予日数は `grace-period-service.ts` (server 専用 module) にだけ存在し、顧客に見える
//   文言側 (labels.ts / LP / 特商法) は「7 日 / 30 日」を文字列で複製していた。
//   複製された数値は、そもそも**退会**の猶予であるにもかかわらず**解約**の説明に転用され、
//   「解約するとデータが削除される」という事実と異なる記述を LP・特商法・アプリ内 FAQ に
//   広げた (#4496 の根本原因)。値を domain leaf に降ろし、表示側は terms.ts の atom
//   (`DELETION_GRACE_TERMS`) 経由でここから引くことで、数値の複製と文脈の取り違えを断つ。
//
// 置き場所の判断:
//   labels.ts / terms.ts は domain 層であり `$lib/server/**` を import できない。
//   一方 grace-period-service.ts は server 専用 module。したがって値を domain leaf に降ろし、
//   server 側がここから import して従来どおり re-export する
//   (履歴保持日数を `plan-retention.ts` に降ろした #4477 と同型)。
//
// 関連: ADR-0013 (LP 文言は実装の事実を SSOT とする) / ADR-0045 (terms.ts atom / labels.ts compound)
//       docs/design/account-deletion-flow.md

import type { PlanTier } from './plan-tier';

/**
 * 退会 (アカウント削除) 申請から物理削除までの猶予日数。`0` = 申請と同時に物理削除。
 *
 * **この 3 つの数値がプロダクト全体の SSOT**。表示文字列側に数値を複製しないこと。
 *
 * 複製の検出は `tests/unit/domain/cancel-vs-deletion-terminology.test.ts` が
 * 「本定数から組み立てた文字列と表示側が一致するか」で行う — 表示側に数値を直書きすると、
 * 本定数を変えた瞬間に同 test が落ちる。
 */
export const DELETION_GRACE_PERIOD_DAYS: Record<PlanTier, number> = {
	free: 0,
	standard: 7,
	family: 30,
};

/**
 * 猶予日数を表示用の期間文字列にする。
 *
 * - `0` → `即時`（猶予なし = 申請と同時に削除）
 * - それ以外 → `N日`
 *
 * @param days 猶予日数
 * @param options.spaced 数値と単位の間に半角スペースを入れる (LP 本文の組版に合わせる)
 */
export function formatDeletionGracePeriod(days: number, options?: { spaced?: boolean }): string {
	if (days === 0) return '即時';
	const sep = options?.spaced ? ' ' : '';
	return `${days}${sep}日`;
}
