// src/lib/server/services/usage-log-service.ts
// 子供の使用時間ログ管理サービス (#1292)

import {
	closeOpenSessions,
	findTodayUsageLogs,
	findUsageLogsByChildAndDateRange,
	insertUsageLog,
	updateUsageLogEnd,
} from '$lib/server/db/usage-log-repo';
import { logger } from '$lib/server/logger';

/** セッション開始を記録する */
export async function startUsageSession(
	tenantId: string,
	childId: number,
): Promise<{ id: number } | null> {
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
