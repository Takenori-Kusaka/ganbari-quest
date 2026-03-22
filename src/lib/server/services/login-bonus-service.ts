// src/lib/server/services/login-bonus-service.ts
// ログインボーナスサービス層

import {
	calcLoginBonusPoints,
	drawOmikuji,
	getLoginMultiplier,
} from '$lib/domain/validation/login-bonus';
import {
	findChildById,
	findRecentBonuses,
	findTodayBonus,
	insertLoginBonus,
} from '$lib/server/db/login-bonus-repo';
import { insertPointEntry } from '$lib/server/db/point-repo';

import { prevDateJST, todayDateJST } from '$lib/domain/date-utils';

/** 今日の日付をYYYY-MM-DD形式で取得 (JST) */
const todayDate = todayDateJST;

/** 前日の日付をYYYY-MM-DD形式で取得 */
const prevDate = prevDateJST;

/** 連続ログイン日数を計算 */
export async function calculateConsecutiveDays(childId: number, today: string): Promise<number> {
	const bonuses = await findRecentBonuses(childId, 60);

	if (bonuses.length === 0) return 1;

	// 昨日のログインがあるか確認
	const yesterday = prevDate(today);
	let consecutive = 1;
	let checkDate = yesterday;

	for (const bonus of bonuses) {
		if (bonus.loginDate === checkDate) {
			consecutive++;
			checkDate = prevDate(checkDate);
		} else {
			break;
		}
	}

	return consecutive;
}

export interface LoginBonusStatus {
	childId: number;
	claimedToday: boolean;
	consecutiveLoginDays: number;
	lastClaimedAt: string | null;
}

export interface ClaimResult {
	childId: number;
	rank: string;
	basePoints: number;
	consecutiveLoginDays: number;
	multiplier: number;
	totalPoints: number;
	message: string;
}

/** ログインボーナスの状態を取得 */
export async function getLoginBonusStatus(
	childId: number,
): Promise<LoginBonusStatus | { error: 'NOT_FOUND' }> {
	const child = await findChildById(childId);
	if (!child) return { error: 'NOT_FOUND' };

	const today = todayDate();
	const todayBonus = await findTodayBonus(childId, today);
	const recentBonuses = await findRecentBonuses(childId, 1);

	return {
		childId,
		claimedToday: !!todayBonus,
		consecutiveLoginDays: todayBonus
			? todayBonus.consecutiveDays
			: await calculateConsecutiveDays(childId, today),
		lastClaimedAt: recentBonuses[0]?.createdAt ?? null,
	};
}

/** ログインボーナスを受け取る */
export async function claimLoginBonus(
	childId: number,
): Promise<ClaimResult | { error: 'NOT_FOUND' } | { error: 'ALREADY_CLAIMED' }> {
	const child = await findChildById(childId);
	if (!child) return { error: 'NOT_FOUND' };

	const today = todayDate();

	// 既に受取済みかチェック
	const existing = await findTodayBonus(childId, today);
	if (existing) return { error: 'ALREADY_CLAIMED' };

	// おみくじ抽選
	const omikuji = drawOmikuji();

	// 連続ログイン日数計算
	const consecutiveDays = await calculateConsecutiveDays(childId, today);

	// 倍率計算
	const multiplier = getLoginMultiplier(consecutiveDays);

	// 最終ポイント
	const totalPoints = calcLoginBonusPoints(omikuji.basePoints, multiplier);

	// DB保存
	await insertLoginBonus({
		childId,
		loginDate: today,
		rank: omikuji.rank,
		basePoints: omikuji.basePoints,
		multiplier,
		totalPoints,
		consecutiveDays,
	});

	// ポイント台帳に記録
	await insertPointEntry({
		childId,
		amount: totalPoints,
		type: 'login_bonus',
		description: `${omikuji.rank}！${totalPoints}ポイントゲット！`,
	});

	// メッセージ組み立て
	let message = `${omikuji.rank}！${totalPoints}ポイントゲット！`;
	if (multiplier > 1) {
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
