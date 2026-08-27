import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/point-service.ts
// ポイント管理サービス層

import {
	jstDayStartUtcIso,
	monthKeyJST,
	monthStartJST,
	shiftMonthKey,
} from '$lib/domain/date-utils';
import { POINT_LEDGER_LABELS } from '$lib/domain/labels';
import { type ConvertMode, POINTS_PER_CONVERT_UNIT } from '$lib/domain/validation/point';
import {
	findChildById,
	findPointHistory,
	findPointHistoryByType,
	getBalance,
	insertPointEntry,
	spendPointsAtomic,
	sumPointsByType,
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

/** おこづかい変換の台帳種別 (`point_ledger.type`)。 */
export const LEDGER_TYPE_CONVERT = 'convert';

/**
 * #4682 F2: `/admin/points` の「おこづかい変換りれき」表示件数。
 * **一覧の表示件数であり、累計の母数ではない** (累計は DB SUM で別に取る)。
 */
export const CONVERT_HISTORY_LIMIT = 100;

export interface ConvertSummary {
	/** 変換だけを新しい順に並べた直近 `CONVERT_HISTORY_LIMIT` 件。 */
	history: Awaited<ReturnType<typeof findPointHistoryByType>>;
	/** 累計変換ポイント (正値)。DB SUM のため一覧件数に依存しない。 */
	allTimeTotal: number;
	/** 今月 (JST 暦月) の変換ポイント (正値)。 */
	thisMonthTotal: number;
	/** 先月 (JST 暦月) の変換ポイント (正値)。 */
	lastMonthTotal: number;
}

/**
 * #4682 F2: おこづかい変換の履歴 + 累計を返す。
 *
 * 旧実装は `getPointHistory({ limit: 50 })` を取ってから `type === 'convert'` で filter し、
 * 累計も同じ配列から算出していたため、活動が多い子では直近 50 行が活動記録で埋まって
 * 「変換りれき」セクションごと消えていた (親が渡し忘れ / 二重払いを起こす)。
 * 抽出と集計をどちらも DB 側に置き、一覧 window から切り離す。
 *
 * 月境界は JST SSOT (`monthKeyJST` / `jstDayStartUtcIso`) で作る (#4015 / #4127)。
 */
export async function getConvertSummary(
	childId: ChildId,
	tenantId: string,
): Promise<ConvertSummary | { error: 'NOT_FOUND' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const thisMonthStart = jstDayStartUtcIso(monthStartJST());
	const lastMonthStart = jstDayStartUtcIso(`${shiftMonthKey(monthKeyJST(), -1)}-01`);

	const [history, allTime, thisMonth, lastMonth] = await Promise.all([
		findPointHistoryByType(
			childId,
			{ type: LEDGER_TYPE_CONVERT, limit: CONVERT_HISTORY_LIMIT },
			tenantId,
		),
		sumPointsByType(childId, { type: LEDGER_TYPE_CONVERT }, tenantId),
		sumPointsByType(childId, { type: LEDGER_TYPE_CONVERT, fromIso: thisMonthStart }, tenantId),
		sumPointsByType(
			childId,
			{ type: LEDGER_TYPE_CONVERT, fromIso: lastMonthStart, toIso: thisMonthStart },
			tenantId,
		),
	]);

	// 変換は負値で記録されるため、画面表示用に絶対値へ倒す。
	return {
		history,
		allTimeTotal: Math.abs(allTime),
		thisMonthTotal: Math.abs(thisMonth),
		lastMonthTotal: Math.abs(lastMonth),
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
	// type は本 file の SSOT 定数を通す (直書き 'convert' だと集計側 sumPointsByType と別々に動く)。
	const spend = await spendPointsAtomic(
		childId,
		amount,
		{ type: LEDGER_TYPE_CONVERT, description },
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
