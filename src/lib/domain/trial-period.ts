// src/lib/domain/trial-period.ts
// #4707: トライアル期間の暦日述語 SSOT。
//
// tier 判定 (`plan-limit-service.resolvePlanTier`) と表示判定 (`trial-service.computeTrialStatus`) が
// 同じ述語を共有する。旧実装は前者が `new Date('YYYY-MM-DD') > new Date()` (UTC 00:00 = JST 09:00 で
// 切れる)、後者が JST 暦日比較 (当日いっぱい有効) で、最終日 09:00〜24:00 JST に
// 「⭐ 残り 0 日 / トライアル中」と表示したまま有料機能が 403 になる 9 時間のずれがあった。
// TZ 依存の日付導出禁止 (#4015 / #4127) 整合のため、暦日は `toJSTDateString` 経由でのみ得る。

import { toJSTDateString } from './date-utils';

/**
 * トライアル終了日 (JST 暦日 'YYYY-MM-DD') が「今日以降」か。
 * トライアルは end_date **当日いっぱい** (JST 23:59:59) 有効。
 * ISO 暦日はゼロ詰め固定長なので文字列の辞書順 = 暦順。
 */
export function isTrialEndDateActiveJST(trialEndDate: string, now: Date = new Date()): boolean {
	return trialEndDate >= toJSTDateString(now);
}

/** JST 暦日ベースの残日数 (end_date 当日 = 0、終了済みは負値)。 */
export function trialDaysRemainingJST(trialEndDate: string, now: Date = new Date()): number {
	const todayDate = new Date(`${toJSTDateString(now)}T00:00:00Z`);
	const endDate = new Date(`${trialEndDate}T00:00:00Z`);
	return Math.round((endDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
}
