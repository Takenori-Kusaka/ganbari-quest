/**
 * デモ用データソース実装
 *
 * インメモリの静的データを返す。書き込み操作は no-op でデモ用成功レスポンスを返す。
 * demo-service.ts のラッパーで、ChildDataSource インターフェースに準拠する。
 */

import { DEMO_ACTIVITIES, getDemoLogsForChild } from '$lib/server/demo/demo-data.js';
import {
	demoCancelRecord,
	demoRecordActivity,
	demoTogglePin,
	getDemoHomeData,
	getDemoStatusData,
} from '$lib/server/demo/demo-service.js';
import type {
	AchievementsPageData,
	CancelResult,
	ChildDataSource,
	HistoryPageData,
	HomePageData,
	LoginStampResult,
	RecordResult,
	StatusPageData,
} from './types.js';

export class DemoChildDataSource implements ChildDataSource {
	async getHomeData(childId: number): Promise<HomePageData> {
		const demo = getDemoHomeData(childId);
		return {
			activities: demo.activities.map((a) => ({
				...a,
				isPinned: false,
				isMainQuest: 0,
			})),
			todayRecorded: demo.todayRecorded,
			loginBonusStatus: demo.loginBonusStatus,
			latestReward: null,
			latestMessage: null,
			hasChecklists: demo.hasChecklists,
			checklistProgress: demo.checklistProgress,
			dailyMissions: demo.dailyMissions,
			stampCard: null,
			categoryXp: null,
			isFirstTime: false,
			recommendedActivityIds: [],
			birthdayBonus: null,
			activeEvents: [],
			activeChallenges: [],
			siblingRanking: null,
			unshownCheers: [],
			monthlyPremiumReward: null,
			specialRewardProgress: null,
		};
	}

	async recordActivity(_childId: number, activityId: number): Promise<RecordResult> {
		const result = demoRecordActivity(activityId);
		return {
			...result,
			masteryBonus: 0,
			masteryLevel: 1,
			masteryLeveledUp: null,
		};
	}

	async cancelRecord(_logId: number, _childId: number): Promise<CancelResult> {
		return demoCancelRecord();
	}

	async claimLoginStamp(_childId: number): Promise<LoginStampResult> {
		return {
			loginStamp: true,
			stampEmoji: '⭐',
			stampRarity: 'N',
			stampName: 'デモスタンプ',
			omikujiRank: 'kichi',
			instantPoints: 5,
			consecutiveLoginDays: 3,
			multiplier: 1,
			cardData: null,
			weeklyRedeem: null,
		};
	}

	async togglePin(
		_childId: number,
		_activityId: number,
		pinned: boolean,
	): Promise<{ isPinned: boolean }> {
		const result = demoTogglePin(pinned);
		return { isPinned: result.isPinned };
	}

	async getStatusData(childId: number): Promise<StatusPageData> {
		const status = getDemoStatusData(childId);
		return {
			status,
			monthlyComparison: null,
		};
	}

	async getAchievementsData(_childId: number): Promise<AchievementsPageData> {
		return {
			activeChallenge: null,
			history: [],
		};
	}

	async getHistoryData(
		childId: number,
		_dateRange: { from: string; to: string },
	): Promise<HistoryPageData> {
		const logs = getDemoLogsForChild(childId);
		const actMap = new Map(DEMO_ACTIVITIES.map((a) => [a.id, a]));
		const byCategory: Record<string, { count: number; points: number }> = {};
		for (const log of logs) {
			const act = actMap.get(log.activityId);
			const catId = String(act?.categoryId ?? 0);
			if (!byCategory[catId]) byCategory[catId] = { count: 0, points: 0 };
			byCategory[catId].count++;
			byCategory[catId].points += log.points;
		}
		return {
			logs: logs.map((l) => {
				const act = actMap.get(l.activityId);
				return {
					id: l.id,
					activityName: act?.name ?? '不明',
					activityIcon: act?.icon ?? '❓',
					categoryId: act?.categoryId ?? 0,
					points: l.points,
					streakDays: l.streakDays,
					streakBonus: l.streakBonus,
					recordedAt: l.recordedAt,
				};
			}),
			summary: {
				totalCount: logs.length,
				totalPoints: logs.reduce((sum, l) => sum + l.points, 0),
				byCategory,
			},
			period: 'week',
		};
	}
}
