import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/point-service.ts
// ポイント管理サービス層

import { POINT_LEDGER_LABELS } from '$lib/domain/labels';
import { type ConvertMode, POINTS_PER_CONVERT_UNIT } from '$lib/domain/validation/point';
import {
	findChildById,
	findPointHistory,
	getBalance,
	insertPointEntry,
	spendPointsAtomic,
} from '$lib/server/db/point-repo';

export interface PointBalance {
	childId: ChildId;
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
	childId: ChildId,
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
	childId: ChildId,
	options: { limit: number; offset: number },
	tenantId: string,
): Promise<{ history: Awaited<ReturnType<typeof findPointHistory>> } | { error: 'NOT_FOUND' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const history = await findPointHistory(childId, options, tenantId);
	return { history };
}

/** baby モードの初期ポイント付与（親が設定した積み立てポイント） */
export async function grantInitialPoints(
	childId: ChildId,
	points: number,
	tenantId: string,
): Promise<
	| { success: true; balance: number }
	| { error: 'NOT_FOUND' }
	| { error: 'INVALID_AMOUNT' }
	| { error: 'CHILD_ARCHIVED' }
> {
	if (points <= 0 || points > 10000) return { error: 'INVALID_AMOUNT' };

	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };
	// #3593 ④: insertPointEntry (writer) は is_archived を filter しない primitive のため、
	// archived な子への加点可否は本 service 層 business rule でガードする (archived = 加点不可)。
	if (child.isArchived) return { error: 'CHILD_ARCHIVED' };

	await insertPointEntry(
		{
			childId,
			amount: points,
			type: 'initial_setup',
			description: POINT_LEDGER_LABELS.initialSetup,
		},
		tenantId,
	);

	const newBalance = await getBalance(childId, tenantId);
	return { success: true, balance: newBalance };
}

/** ポイントをお小遣いに変換 */
export async function convertPoints(
	childId: ChildId,
	amount: number,
	tenantId: string,
	mode: ConvertMode = 'preset',
): Promise<ConvertResult | { error: 'NOT_FOUND' } | { error: 'INSUFFICIENT_POINTS' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const description = POINT_LEDGER_LABELS.convert(amount, mode);

	// #4722 (#3347 と同型): 残高確認 → 台帳挿入を await を跨いで行うと、二重送信 / 連打で
	// 両方が同じ残高を読んで二重に引き落とし、**残高がマイナス**になり得た。
	// 交換 (reward-redemption) と同じ原子境界 `spendPointsAtomic` に寄せ、
	// 「再読込 → 非負確認 → 挿入」を backend の 1 単位で実行する。
	const spend = await spendPointsAtomic(
		childId,
		amount,
		{ type: 'convert', description },
		tenantId,
	);
	if ('error' in spend) return { error: 'INSUFFICIENT_POINTS' };

	// 引き落とし後の残高を実データから読み直す (計算で出すと並行操作とズレる)。
	const remainingBalance = await getBalance(childId, tenantId);

	return {
		message: description,
		convertedAmount: amount,
		remainingBalance,
	};
}
