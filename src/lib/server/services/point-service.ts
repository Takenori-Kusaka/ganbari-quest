// src/lib/server/services/point-service.ts
// ポイント管理サービス層

import { type ConvertMode, POINTS_PER_CONVERT_UNIT } from '$lib/domain/validation/point';
import {
	findChildById,
	findPointHistory,
	getBalance,
	insertPointEntry,
} from '$lib/server/db/point-repo';

export interface PointBalance {
	childId: number;
	balance: number;
	convertableAmount: number;
	nextConvertAt: number;
}

export interface ConvertResult {
	message: string;
	convertedAmount: number;
	remainingBalance: number;
}

/** ポイント残高を取得 */
export function getPointBalance(childId: number): PointBalance | { error: 'NOT_FOUND' } {
	const child = findChildById(childId);
	if (!child) return { error: 'NOT_FOUND' };

	const balance = getBalance(childId);
	const unit = POINTS_PER_CONVERT_UNIT;
	const convertableAmount = Math.floor(balance / unit) * unit;
	const nextConvertAt = balance >= unit ? balance : unit;

	return {
		childId,
		balance,
		convertableAmount,
		nextConvertAt,
	};
}

/** ポイント履歴を取得 */
export function getPointHistory(
	childId: number,
	options: { limit: number; offset: number },
): { history: ReturnType<typeof findPointHistory> } | { error: 'NOT_FOUND' } {
	const child = findChildById(childId);
	if (!child) return { error: 'NOT_FOUND' };

	const history = findPointHistory(childId, options);
	return { history };
}

/** 変換モード別の説明文サフィックス */
function convertDescription(amount: number, mode: ConvertMode): string {
	const base = `${amount}ポイントをおこづかいにかえました`;
	if (mode === 'manual') return `${base}（手動入力）`;
	if (mode === 'receipt') return `${base}（領収書読み取り）`;
	return base;
}

/** ポイントをお小遣いに変換 */
export function convertPoints(
	childId: number,
	amount: number,
	mode: ConvertMode = 'preset',
): ConvertResult | { error: 'NOT_FOUND' } | { error: 'INSUFFICIENT_POINTS' } {
	const child = findChildById(childId);
	if (!child) return { error: 'NOT_FOUND' };

	const balance = getBalance(childId);
	if (balance < amount) {
		return { error: 'INSUFFICIENT_POINTS' };
	}

	const description = convertDescription(amount, mode);

	// ポイント消費エントリを台帳に記録（マイナス値）
	insertPointEntry({
		childId,
		amount: -amount,
		type: 'convert',
		description,
	});

	const remainingBalance = balance - amount;

	return {
		message: description,
		convertedAmount: amount,
		remainingBalance,
	};
}
