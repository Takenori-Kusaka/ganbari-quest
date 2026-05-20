// src/lib/server/services/usage-log-service.ts
// 子供の使用時間ログ管理サービス (#1292)
//
// #2338 (2026-05-20): 本番 cognito Lambda (DATA_SOURCE=dynamodb) で 500 発生。
// usage-log-repo は SQLite のみ実装 (Pre-PMF: ADR-0010 Bucket B)。
// DATA_SOURCE が 'dynamodb' / 'demo' の場合は no-op fallback で graceful degradation。
// PMF 後の DynamoDB 完全実装 roadmap は docs/rationale/07-usage-log-dynamodb-deferred-rationale.md 参照。

import {
	closeOpenSessions,
	findTodayUsageLogs,
	findUsageLogsByChildAndDateRange,
	insertUsageLog,
	updateUsageLogEnd,
} from '$lib/server/db/usage-log-repo';
import { logger } from '$lib/server/logger';

/**
 * DATA_SOURCE が SQLite 以外 (dynamodb / demo) かを判定。
 * env を都度読むことで vitest `vi.stubEnv` での切替を可能にしている。
 */
function isUsageLogNoopBackend(): boolean {
	const dataSource = process.env.DATA_SOURCE ?? 'sqlite';
	return dataSource === 'dynamodb' || dataSource === 'demo';
}

let noopNotified = false;
/**
 * no-op 動作を 1 回だけ logger.info で可視化する (隠蔽防止、
 * `feedback_no_escape_to_haribote_implementation.md` 整合)。
 * テスト用に `resetNoopNotifiedForTesting()` でリセット可能。
 */
function notifyNoopOnce(): void {
	if (noopNotified) return;
	noopNotified = true;
	logger.info(
		'[usage-log] DATA_SOURCE 非 sqlite 環境を検出。no-op fallback で動作 (ADR-0010 Bucket B、#2338)',
		{
			context: { dataSource: process.env.DATA_SOURCE ?? 'sqlite' },
		},
	);
}

/** テスト専用: notifyNoopOnce の状態リセット */
export function resetNoopNotifiedForTesting(): void {
	noopNotified = false;
}

/** セッション開始を記録する */
export async function startUsageSession(
	tenantId: string,
	childId: number,
): Promise<{ id: number } | null> {
	if (isUsageLogNoopBackend()) {
		notifyNoopOnce();
		return { id: 0 }; // dummy id (client は fire-and-forget なので未参照)
	}
	try {
		// 既存の進行中セッションを終了させてから新規作成
		const now = new Date().toISOString();
		await closeOpenSessions(childId, now, tenantId);

		const result = await insertUsageLog({
			tenantId,
			childId,
			startedAt: now,
		});
		return result ?? null;
	} catch (e) {
		logger.warn('[usage-log] セッション開始記録に失敗', {
			context: { tenantId, childId, error: String(e) },
		});
		return null;
	}
}

/** セッション終了を記録する */
export async function endUsageSession(
	id: number,
	tenantId: string,
): Promise<{ durationSec: number } | null> {
	if (isUsageLogNoopBackend()) {
		notifyNoopOnce();
		return { durationSec: 0 };
	}
	try {
		const now = new Date().toISOString();
		const updated = await updateUsageLogEnd(id, now, 0, tenantId);
		if (!updated) return null;

		const startMs = new Date(updated.startedAt).getTime();
		const endMs = new Date(now).getTime();
		const durationSec = Math.max(0, Math.floor((endMs - startMs) / 1000));

		// durationSec を正しく設定し直す
		await updateUsageLogEnd(id, now, durationSec, tenantId);
		return { durationSec };
	} catch (e) {
		logger.warn('[usage-log] セッション終了記録に失敗', {
			context: { id, tenantId, error: String(e) },
		});
		return null;
	}
}

/** 本日の子供ごとの使用時間サマリーを取得（分単位） */
export async function getTodayUsageSummary(
	tenantId: string,
	children: { id: number; nickname: string }[],
): Promise<{ childId: number; childName: string; durationMin: number }[]> {
	if (isUsageLogNoopBackend()) {
		notifyNoopOnce();
		return children.map((child) => ({
			childId: child.id,
			childName: child.nickname,
			durationMin: 0,
		}));
	}
	try {
		const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
		const logs = await findTodayUsageLogs(tenantId, today);

		const summaryMap = new Map<number, number>();
		for (const log of logs) {
			const existing = summaryMap.get(log.childId) ?? 0;
			const sec = log.durationSec ?? 0;
			summaryMap.set(log.childId, existing + sec);
		}

		return children.map((child) => ({
			childId: child.id,
			childName: child.nickname,
			durationMin: Math.round((summaryMap.get(child.id) ?? 0) / 60),
		}));
	} catch (e) {
		logger.warn('[usage-log] 本日使用時間取得に失敗', {
			context: { tenantId, error: String(e) },
		});
		return children.map((child) => ({
			childId: child.id,
			childName: child.nickname,
			durationMin: 0,
		}));
	}
}

/** 直近7日間の子供ごとの日別使用時間を取得（分単位） */
export async function getWeeklyUsageSummary(
	tenantId: string,
	childId: number,
): Promise<{ date: string; durationMin: number }[]> {
	if (isUsageLogNoopBackend()) {
		notifyNoopOnce();
		// 直近 7 日の空エントリを返す (call side が空配列を空 chart として描画する想定)
		const today = new Date();
		const entries: { date: string; durationMin: number }[] = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			entries.push({ date: d.toISOString().slice(0, 10), durationMin: 0 });
		}
		return entries;
	}
	try {
		const today = new Date();
		const toDate = new Date(today);
		toDate.setDate(toDate.getDate() + 1); // tomorrow
		const fromDate = new Date(today);
		fromDate.setDate(fromDate.getDate() - 6); // 7 days ago

		const fromStr = fromDate.toISOString().slice(0, 10);
		const toStr = toDate.toISOString().slice(0, 10);

		const logs = await findUsageLogsByChildAndDateRange(childId, tenantId, fromStr, toStr);

		// 日付ごとに集計
		const dailyMap = new Map<string, number>();

		// 直近7日の空エントリを先に作成
		for (let i = 6; i >= 0; i--) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			const dateStr = d.toISOString().slice(0, 10);
			dailyMap.set(dateStr, 0);
		}

		for (const log of logs) {
			const date = log.startedAt.slice(0, 10);
			const existing = dailyMap.get(date) ?? 0;
			dailyMap.set(date, existing + (log.durationSec ?? 0));
		}

		return Array.from(dailyMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, sec]) => ({
				date,
				durationMin: Math.round(sec / 60),
			}));
	} catch (e) {
		logger.warn('[usage-log] 週次使用時間取得に失敗', {
			context: { tenantId, childId, error: String(e) },
		});
		return [];
	}
}
