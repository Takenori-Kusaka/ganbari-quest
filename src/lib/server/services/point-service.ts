// src/lib/server/services/point-service.ts
// ポイント管理サービス層

import {
	getBalance,
	findPointHistory,
	insertPointEntry,
	findChildById,
} from '$lib/server/db/point-repo';
import { POINTS_PER_CONVERT_UNIT } from '$lib/domain/validation/point';

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
export function getPointBalance(
	childId: number,
): PointBalance | { error: 'NOT_FOUND' } {
	const child = findChildById(childId);
	if (!child) return { error: 'NOT_FOUND' };

	const balance = getBalance(childId);
	const unit = POINTS_PER_CONVERT_UNIT;
	const convertableAmount = Math.floor(balance / unit) * unit;
	const nextConvertAt =
		balance >= unit ? balance : unit;

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

/** ポイントをお小遣いに変換（500P単位） */
export function convertPoints(
	childId: number,
	amount: number,
): ConvertResult | { error: 'NOT_FOUND' } | { error: 'INSUFFICIENT_POINTS' } {
	const child = findChildById(childId);
	if (!child) return { error: 'NOT_FOUND' };

	const balance = getBalance(childId);
	if (balance < amount) {
		return { error: 'INSUFFICIENT_POINTS' };
	}

	// ポイント消費エントリを台帳に記録（マイナス値）
	insertPointEntry({
		childId,
		amount: -amount,
		type: 'convert',
		description: `${amount}ポイントをおこづかいにかえました`,
	});

	const remainingBalance = balance - amount;

	return {
		message: `${amount}ポイントをおこづかいにかえました`,
		convertedAmount: amount,
		remainingBalance,
	};
}
