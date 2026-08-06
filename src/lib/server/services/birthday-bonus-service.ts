import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/birthday-bonus-service.ts
// 誕生日ボーナスポイントの判定・付与サービス

import { addDaysJST, todayDateJST } from '$lib/domain/date-utils';
import type { UiMode } from '$lib/domain/validation/age-tier';
import { getDefaultUiMode } from '$lib/domain/validation/age-tier';
import { findChildById, updateChild } from '$lib/server/db/child-repo';
import { insertPointEntry } from '$lib/server/db/point-repo';
import type { Child } from '$lib/server/db/types';
import { recordUiModeChangeNotice } from '$lib/server/services/ui-mode-change-notice-service';

// ============================================================
// Constants
// ============================================================

/** ポイント計算: 年齢 × BASE_POINTS × 倍率 */
const BASE_POINTS_PER_AGE = 100;

/** 誕生日から何日間受け取れるか */
const CLAIM_WINDOW_DAYS = 3;

// ============================================================
// Types
// ============================================================

export interface BirthdayBonusStatus {
	eligible: boolean;
	alreadyClaimed: boolean;
	expired: boolean;
	newAge: number | null;
	totalPoints: number | null;
	claimDeadline: string | null;
}

export interface BirthdayBonusClaimResult {
	childId: ChildId;
	newAge: number;
	basePoints: number;
	multiplier: number;
	totalPoints: number;
}

// ============================================================
// Helper functions
// ============================================================

/** birthDate (YYYY-MM-DD) から年齢を計算 */
export function calculateAge(birthDate: string, referenceDate: string): number {
	// 暦日文字列どうしの比較で完結させる (Date 経由だと runtime TZ で結果が変わりうる、#4127)
	const [by, bm, bd] = birthDate.split('-').map(Number);
	const [ry, rm, rd] = referenceDate.split('-').map(Number);
	let age = (ry ?? 0) - (by ?? 0);
	if ((rm ?? 0) < (bm ?? 0) || ((rm ?? 0) === (bm ?? 0) && (rd ?? 0) < (bd ?? 0))) {
		age--;
	}
	return Math.max(0, age);
}

/** 今日が誕生日当日〜請求期間内かどうか */
export function isBirthdayWindow(birthDate: string, today: string): boolean {
	const birthMD = birthDate.slice(5); // "MM-DD"

	for (let i = 0; i < CLAIM_WINDOW_DAYS; i++) {
		const checkMD = addDaysJST(today, -i).slice(5);
		if (checkMD === birthMD) {
			return true;
		}
	}
	return false;
}

/** 誕生日の請求期限日を計算 */
export function getClaimDeadline(birthDate: string, today: string): string | null {
	const birthMD = birthDate.slice(5); // "MM-DD"
	const birthdayThisYear = `${today.slice(0, 4)}-${birthMD}`;
	return addDaysJST(birthdayThisYear, CLAIM_WINDOW_DAYS - 1);
}

/** ボーナスポイントを計算 */
export function calcBirthdayBonus(age: number, multiplier: number): number {
	return Math.round(age * BASE_POINTS_PER_AGE * multiplier);
}

// ============================================================
// Service functions
// ============================================================

/** 誕生日ボーナスの状態を取得 */
export async function getBirthdayBonusStatus(
	childId: ChildId,
	tenantId: string,
): Promise<BirthdayBonusStatus | { error: 'NOT_FOUND' } | { error: 'NO_BIRTHDATE' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };
	if (!child.birthDate) return { error: 'NO_BIRTHDATE' };

	const today = todayDateJST();
	return checkBirthdayStatus(child, today);
}

/** 内部: Child + today から状態判定（テスト用にもエクスポート） */
export function checkBirthdayStatus(child: Child, today: string): BirthdayBonusStatus {
	if (!child.birthDate) {
		return {
			eligible: false,
			alreadyClaimed: false,
			expired: false,
			newAge: null,
			totalPoints: null,
			claimDeadline: null,
		};
	}

	const currentYear = Number(today.slice(0, 4));
	const alreadyClaimed = child.lastBirthdayBonusYear === currentYear;
	const inWindow = isBirthdayWindow(child.birthDate, today);
	const newAge = calculateAge(child.birthDate, today);
	const multiplier = child.birthdayBonusMultiplier ?? 1.0;
	const totalPoints = calcBirthdayBonus(newAge, multiplier);
	const claimDeadline = inWindow ? getClaimDeadline(child.birthDate, today) : null;

	return {
		eligible: inWindow && !alreadyClaimed,
		alreadyClaimed,
		expired: !inWindow && !alreadyClaimed,
		newAge: inWindow ? newAge : null,
		totalPoints: inWindow ? totalPoints : null,
		claimDeadline,
	};
}

/** 誕生日ボーナスを請求（ポイント付与 + 年齢更新） */
export async function claimBirthdayBonus(
	childId: ChildId,
	tenantId: string,
): Promise<
	| BirthdayBonusClaimResult
	| { error: 'NOT_FOUND' }
	| { error: 'NO_BIRTHDATE' }
	| { error: 'NOT_ELIGIBLE' }
	| { error: 'ALREADY_CLAIMED' }
> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };
	if (!child.birthDate) return { error: 'NO_BIRTHDATE' };

	const today = todayDateJST();
	const status = checkBirthdayStatus(child, today);

	if (status.alreadyClaimed) return { error: 'ALREADY_CLAIMED' };
	if (!status.eligible) return { error: 'NOT_ELIGIBLE' };

	const newAge = status.newAge ?? calculateAge(child.birthDate, today);
	const multiplier = child.birthdayBonusMultiplier ?? 1.0;
	const totalPoints = calcBirthdayBonus(newAge, multiplier);
	const currentYear = Number(today.slice(0, 4));

	// #580: 年齢境界（preschool/elementary/junior/senior）を跨いだ場合、
	// uiMode も自動的に再計算する。ポリシー: 常に自動上書き（手動設定は誕生日後に再調整）。
	const newUiMode = getDefaultUiMode(newAge);

	// uiMode 再計算 + 重複防止フラグ設定（age 更新は age-recalc cron に移譲）
	await updateChild(
		childId,
		{
			uiMode: newUiMode,
			lastBirthdayBonusYear: currentYear,
		},
		tenantId,
	);

	// #4313: uiMode が実際に変わったときだけ、次回ログイン告知用の pending notice を残す。
	// 本経路は uiModeManuallySet を無視して常に上書きする (#580 の意図的決定) ため、
	// age-recalc cron 側だけを塞ぐと穴が残る。
	if (child.uiMode !== newUiMode) {
		await recordUiModeChangeNotice(
			{
				childId,
				from: child.uiMode as UiMode,
				to: newUiMode,
				changedOn: today,
			},
			tenantId,
		);
	}

	// ポイント台帳に記録
	await insertPointEntry(
		{
			childId,
			amount: totalPoints,
			type: 'birthday_bonus',
			description: `${newAge}さいのおたんじょうびボーナス`,
		},
		tenantId,
	);

	return {
		childId,
		newAge,
		basePoints: newAge * BASE_POINTS_PER_AGE,
		multiplier,
		totalPoints,
	};
}
