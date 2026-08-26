import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/usage-log-service.ts
// 子供の使用時間ログ管理サービス (#1292)
//
// #4719: backend 分岐は持たない。usage-log-repo facade → factory (getRepos().usageLog) が
// sqlite / pg-core (DSQL・PGlite) / demo (stub) を選ぶ。以前の「DATA_SOURCE=demo だけ no-op、
// それ以外は sqlite 固定」は本番 pg で表未作成 throw → WARN + 0 分に化けていた (#4680 class)。

import {
	addDaysJST,
	jstDayStartUtcIso,
	todayDateJST,
	toJSTDateString,
} from '$lib/domain/date-utils';
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
	childId: ChildId,
): Promise<{ id: string } | null> {
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
	id: string,
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
	children: { id: ChildId; nickname: string }[],
): Promise<{ childId: ChildId; childName: string; durationMin: number }[]> {
	try {
		// 「今日」は JST 基準。UTC 暦日で絞ると JST 00:00〜09:00 の利用が前日集計に入り、
		// 保護者画面の「今日の利用時間」が 9 時間ぶん 0 分のままになる (#4127)。
		const logs = await findTodayUsageLogs(tenantId, jstDayStartUtcIso(todayDateJST()));

		const summaryMap = new Map<ChildId, number>();
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
	childId: ChildId,
): Promise<{ date: string; durationMin: number }[]> {
	try {
		// 範囲も日次バケットも JST 基準で揃える (書き込みは UTC ISO、読み出しは JST 暦日、#4127)
		const today = todayDateJST();
		const fromIso = jstDayStartUtcIso(addDaysJST(today, -6));
		const toIso = jstDayStartUtcIso(addDaysJST(today, 1)); // 翌日 00:00 (JST) 未満

		const logs = await findUsageLogsByChildAndDateRange(childId, tenantId, fromIso, toIso);

		// 日付ごとに集計
		const dailyMap = new Map<string, number>();

		// 直近7日の空エントリを先に作成
		for (let i = 6; i >= 0; i--) {
			dailyMap.set(addDaysJST(today, -i), 0);
		}

		for (const log of logs) {
			const date = toJSTDateString(new Date(log.startedAt));
			// 直近 7 日のキーのみ集計 (範囲外日付は無視、#2391 PR-2402 flaky 修正)
			if (!dailyMap.has(date)) continue;
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
