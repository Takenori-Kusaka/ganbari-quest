/**
 * データソース抽象レイヤ — 型定義
 *
 * 本番 (DB) とデモ (インメモリ) のデータソースを統一するインターフェース。
 * #568: デモルートをアダプタパターンで本番ルートに統合するための基盤。
 */

import type { PointSettings } from '$lib/domain/point-display';
import type { Activity, Child } from '$lib/server/db/types/index.js';
import type { DailyMissionStatus } from '$lib/server/services/daily-mission-service';
import type { LoginBonusStatus } from '$lib/server/services/login-bonus-service';
import type { ChildStatus } from '$lib/server/services/status-service';

// ============================================================
// Layout data
// ============================================================

export interface ChildLayoutData {
	child: Child | null;
	balance: number;
	level: number;
	levelTitle: string;
	avatarConfig: unknown;
	allChildren: Child[];
	uiMode: string;
	pointSettings: PointSettings;
	isPremium: boolean;
}

// ============================================================
// Home page
// ============================================================

export interface ActivityWithDisplay extends Activity {
	displayName: string;
	isMission: boolean;
	isPinned?: boolean;
	isMainQuest?: boolean;
}

export interface HomePageData {
	activities: ActivityWithDisplay[];
	todayRecorded: { activityId: number; count: number }[];
	loginBonusStatus: LoginBonusStatus | null;
	latestReward: unknown;
	latestMessage: unknown;
	hasChecklists: boolean;
	checklistProgress: { checkedCount: number; totalCount: number; allDone: boolean } | null;
	dailyMissions: DailyMissionStatus | null;
	stampCard: unknown;
	categoryXp: Record<number, unknown> | null;
	isFirstTime: boolean;
	recommendedActivityIds: number[];
	birthdayBonus: unknown;
	activeEvents: unknown[];
	activeChallenges: unknown[];
	siblingRanking: unknown;
	unshownCheers: unknown[];
	monthlyPremiumReward: unknown;
	specialRewardProgress: unknown;
}

export interface RecordResult {
	success: boolean;
	logId: number;
	activityName: string;
	totalPoints: number;
	streakDays: number;
	streakBonus: number;
	masteryBonus: number;
	masteryLevel: number;
	masteryLeveledUp: { oldLevel: number; newLevel: number; isMilestone: boolean } | null;
	cancelableUntil: string;
	comboBonus: unknown;
	missionComplete: unknown;
	levelUp: unknown;
}

export interface CancelResult {
	success: boolean;
	cancelled: boolean;
	refundedPoints: number;
}

export interface LoginStampResult {
	loginStamp: boolean;
	stampEmoji: string;
	stampRarity: string;
	stampName: string;
	omikujiRank: string | null;
	instantPoints: number;
	consecutiveLoginDays: number;
	multiplier: number;
	cardData: unknown;
	weeklyRedeem: unknown;
}

// ============================================================
// Status page
// ============================================================

export interface StatusPageData {
	status: ChildStatus | null;
	monthlyComparison: unknown;
}

// ============================================================
// History page
// ============================================================

export interface HistoryLog {
	id: number;
	activityName: string;
	activityIcon: string;
	categoryId: number;
	points: number;
	streakDays: number;
	streakBonus: number;
	recordedAt: string;
}

export interface HistoryPageData {
	logs: HistoryLog[];
	summary: {
		totalCount: number;
		totalPoints: number;
		byCategory: Record<string, { count: number; points: number }>;
	};
	period: string;
}

// ============================================================
// Achievements page
// ============================================================

export interface AchievementsPageData {
	activeChallenge: unknown;
	history: unknown[];
}

// ============================================================
// DataSource interface
// ============================================================

/**
 * Child ページ群のデータソース。
 * 本番 (DbChildDataSource) とデモ (DemoChildDataSource) で実装を切り替える。
 */
export interface ChildDataSource {
	/** ホームページデータ取得 */
	getHomeData(childId: number): Promise<HomePageData>;

	/** 活動記録 */
	recordActivity(childId: number, activityId: number): Promise<RecordResult>;

	/** 記録取り消し */
	cancelRecord(logId: number, childId: number): Promise<CancelResult>;

	/** ログインスタンプ（ボーナス + スタンプカード） */
	claimLoginStamp(childId: number): Promise<LoginStampResult>;

	/** アクティビティピン切替 */
	togglePin(childId: number, activityId: number, pinned: boolean): Promise<{ isPinned: boolean }>;

	/** ステータスページデータ取得 */
	getStatusData(childId: number): Promise<StatusPageData>;

	/** 実績ページデータ取得 */
	getAchievementsData(childId: number): Promise<AchievementsPageData>;

	/** 履歴ページデータ取得 */
	getHistoryData(
		childId: number,
		dateRange: { from: string; to: string },
	): Promise<HistoryPageData>;
}
