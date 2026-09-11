// src/lib/domain/trial-started-notice.ts
// PO 決裁 2026-09-10 決定 3(a): 申込経路 (/pricing → ?plan=) で**自動で始まった**体験を
// 着地画面で 1 度だけ告げる。告げないと、始めた覚えの無い顧客が後で「無料体験を始める」を
// 押して「すでに使用済みです」に当たる。1 世帯 1 回きりなので取り返しがつかない。
//
// 告知は query に乗るが query は落ちる: #4885 のセットアップ必須 redirect が新規テナント
// (子供 0 人) の要求を query ごと /setup へ倒すため、申込経路の顧客は 100% 告知を失う。
// 着地画面が 2 つ (admin layout / ウィザード 1 枚目) になるので、key と判定をここに置く。

import { formatJSTDate } from './date-utils';

/** 自動開始した体験の告知を運ぶ query key。 */
export const TRIAL_STARTED_QUERY_KEY = 'trialStarted';

/** 告知の旗**だけ**を次の hop に持ち込む (`''` か `'?trialStarted=1'`)。他の query は運ばない。 */
export function carryTrialStartedQuery(search: string): string {
	return new URLSearchParams(search).get(TRIAL_STARTED_QUERY_KEY) === '1'
		? `?${TRIAL_STARTED_QUERY_KEY}=1`
		: '';
}

/**
 * 告知に出す終了日 (整形済み)。**旗が立っていて、かつ実際に体験中のときだけ**返す
 * (始まっていないのに「始まりました」と出さない)。日付はその日いっぱい使える最後の日。
 */
export function resolveTrialStartedNoticeEndDate(
	search: URLSearchParams,
	trial: { isTrialActive: boolean; trialEndDate?: string | null },
): string | null {
	if (search.get(TRIAL_STARTED_QUERY_KEY) !== '1') return null;
	if (!trial.isTrialActive || !trial.trialEndDate) return null;
	return formatJSTDate(trial.trialEndDate);
}
