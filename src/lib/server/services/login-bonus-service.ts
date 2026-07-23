import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/login-bonus-service.ts
// ログインボーナスサービス層 (#3330 案 B counter 縮約)
//
// per-date 行 (旧 login_bonuses) を廃し、子供ごとの counter (lastLoginDate + currentStreak)
// のみで status / claim を賄う。旧 O(60) 遡り再計算は O(1) 参照になる。
// 倍率テーブル / おみくじ / point_ledger 記帳は不変 (UI から見える観測契約は不変)。

import { prevDateJST, todayDateJST } from '$lib/domain/date-utils';
import {
	calcLoginBonusPoints,
	deriveConsecutiveDays,
	drawOmikuji,
	getLoginMultiplier,
} from '$lib/domain/validation/login-bonus';
import { claimToday, findChildById, findStreak } from '$lib/server/db/login-bonus-repo';
import { insertPointEntry } from '$lib/server/db/point-repo';

/** 今日の日付をYYYY-MM-DD形式で取得 (JST) */
const todayDate = todayDateJST;

/** 前日の日付をYYYY-MM-DD形式で取得 */
const prevDate = prevDateJST;

export interface LoginBonusStatus {
	childId: ChildId;
	claimedToday: boolean;
	consecutiveLoginDays: number;
	lastClaimedAt: string | null;
}

export interface ClaimResult {
	childId: ChildId;
	rank: string;
	basePoints: number;
	consecutiveLoginDays: number;
	multiplier: number;
	totalPoints: number;
	message: string;
}

/** ログインボーナスの状態を取得 (counter 1 行の O(1) 参照) */
export async function getLoginBonusStatus(
	childId: ChildId,
	tenantId: string,
): Promise<LoginBonusStatus | { error: 'NOT_FOUND' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const today = todayDate();
	const streak = await findStreak(childId, tenantId);

	return {
		childId,
		claimedToday: streak?.lastLoginDate === today,
		consecutiveLoginDays: deriveConsecutiveDays(streak, today),
		lastClaimedAt: streak?.updatedAt ?? null,
	};
}

/** ログインボーナスを受け取る */
export async function claimLoginBonus(
	childId: ChildId,
	tenantId: string,
): Promise<ClaimResult | { error: 'NOT_FOUND' } | { error: 'ALREADY_CLAIMED' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const today = todayDate();

	// counter への conditional write (当日冪等 + increment/reset を単一 SQL 文で原子的に実行)。
	// 同時 claim 2 連発でも勝者は 1 つだけで、敗者は ALREADY_CLAIMED になる (二重加点なし)。
	const claimed = await claimToday(childId, today, prevDate(today), tenantId);
	if (!claimed) return { error: 'ALREADY_CLAIMED' };

	const consecutiveDays = claimed.currentStreak;

	// おみくじ抽選
	const omikuji = drawOmikuji();

	// 倍率計算（連続ログイン）
	const streakMultiplier = getLoginMultiplier(consecutiveDays);

	// ロイヤルティ倍率（サブスク継続月数に応じた追加倍率）
	let loyaltyMultiplier = 1.0;
	try {
		const { getSubscriptionMonths, getLoginBonusMultiplier } = await import(
			'$lib/server/services/loyalty-service'
		);
		const months = await getSubscriptionMonths(tenantId);
		loyaltyMultiplier = getLoginBonusMultiplier(months);
	} catch {
		// ロイヤルティ取得失敗はボーナスフロー全体を止めない
	}

	const multiplier = streakMultiplier;
	// 最終ポイント（ロイヤルティ倍率を追加適用）
	const totalPoints = Math.round(
		calcLoginBonusPoints(omikuji.basePoints, multiplier) * loyaltyMultiplier,
	);

	// ポイント台帳に記録
	await insertPointEntry(
		{
			childId,
			amount: totalPoints,
			type: 'login_bonus',
			description: `${omikuji.rank}！${totalPoints}ポイントゲット！`,
		},
		tenantId,
	);

	// メッセージ組み立て
	let message = `${omikuji.rank}！${totalPoints}ポイントゲット！`;
	if (loyaltyMultiplier > 1 && multiplier > 1) {
		message = `${omikuji.rank}！${consecutiveDays}にちれんぞく＋サポーターボーナス！${totalPoints}ポイントゲット！`;
	} else if (loyaltyMultiplier > 1) {
		message = `${omikuji.rank}！⭐サポーターボーナス！${totalPoints}ポイントゲット！`;
	} else if (multiplier > 1) {
		message = `${omikuji.rank}！${consecutiveDays}にちれんぞくで${multiplier}ばい！${totalPoints}ポイントゲット！`;
	}

	return {
		childId,
		rank: omikuji.rank,
		basePoints: omikuji.basePoints,
		consecutiveLoginDays: consecutiveDays,
		multiplier,
		totalPoints,
		message,
	};
}
