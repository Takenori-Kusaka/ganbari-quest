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
export async function getPointBalance(
	childId: number,
	tenantId: string,
): Promise<PointBalance | { error: 'NOT_FOUND' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const balance = await getBalance(childId, tenantId);
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
export async function getPointHistory(
	childId: number,
	options: { limit: number; offset: number },
	tenantId: string,
): Promise<{ history: Awaited<ReturnType<typeof findPointHistory>> } | { error: 'NOT_FOUND' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const history = await findPointHistory(childId, options, tenantId);
	return { history };
}

/** 変換モード別の説明文サフィックス */
function convertDescription(amount: number, mode: ConvertMode): string {
	const base = `${amount}ポイントをおこづかいにかえました`;
	if (mode === 'manual') return `${base}（手動入力）`;
	if (mode === 'receipt') return `${base}（領収書読み取り）`;
	return base;
}

/** baby モードの初期ポイント付与（親が設定した積み立てポイント） */
export async function grantInitialPoints(
	childId: number,
	points: number,
	tenantId: string,
): Promise<
	{ success: true; balance: number } | { error: 'NOT_FOUND' } | { error: 'INVALID_AMOUNT' }
> {
	if (points <= 0 || points > 10000) return { error: 'INVALID_AMOUNT' };

	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	await insertPointEntry(
		{
			childId,
			amount: points,
			type: 'initial_setup',
			description: '親による初期ポイント設定',
		},
		tenantId,
	);

	const newBalance = await getBalance(childId, tenantId);
	return { success: true, balance: newBalance };
}

/** ポイントをお小遣いに変換 */
export async function convertPoints(
	childId: number,
	amount: number,
	tenantId: string,
	mode: ConvertMode = 'preset',
): Promise<ConvertResult | { error: 'NOT_FOUND' } | { error: 'INSUFFICIENT_POINTS' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const balance = await getBalance(childId, tenantId);
	if (balance < amount) {
		return { error: 'INSUFFICIENT_POINTS' };
	}

	const description = convertDescription(amount, mode);

	// ポイント消費エントリを台帳に記録（マイナス値）
	await insertPointEntry(
		{
			childId,
			amount: -amount,
			type: 'convert',
			description,
		},
		tenantId,
	);

	const remainingBalance = balance - amount;

	return {
		message: description,
		convertedAmount: amount,
		remainingBalance,
	};
}
