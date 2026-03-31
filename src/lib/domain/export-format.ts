// src/lib/domain/export-format.ts
// エクスポートファイルのフォーマット型定義

export const EXPORT_FORMAT = 'ganbari-quest-backup' as const;
export const EXPORT_VERSION = '1.1.0' as const;

// ============================================================
// マスタデータ型
// ============================================================

export interface ExportCategory {
	id: number;
	code: string;
	name: string;
	icon: string | null;
	color: string | null;
}

export interface ExportActivity {
	name: string;
	categoryCode: string;
	icon: string;
	basePoints: number;
	gradeLevel: string | null;
	nameKana: string | null;
	nameKanji: string | null;
	triggerHint: string | null;
}

export interface ExportTitle {
	code: string;
	name: string;
	icon: string;
	rarity: string;
}

export interface ExportAchievement {
	code: string;
	name: string;
	icon: string;
	rarity: string;
}

// ============================================================
// 家族データ型
// ============================================================

export interface ExportChild {
	exportId: string;
	nickname: string;
	age: number;
	birthDate: string | null;
	theme: string;
	uiMode: string;
	avatarUrl: string | null;
	activeTitle: string | null;
	createdAt: string;
}

// ============================================================
// トランザクションデータ型
// ============================================================

export interface ExportActivityLog {
	childRef: string;
	activityName: string;
	activityCategory: string;
	points: number;
	streakDays: number;
	streakBonus: number;
	recordedDate: string;
	recordedAt: string;
	cancelled: boolean;
}

export interface ExportPointLedger {
	childRef: string;
	amount: number;
	type: string;
	description: string | null;
	createdAt: string;
}

export interface ExportStatus {
	childRef: string;
	categoryCode: string;
	value: number;
	updatedAt: string;
}

export interface ExportStatusHistory {
	childRef: string;
	categoryCode: string;
	value: number;
	changeAmount: number;
	changeType: string;
	recordedAt: string;
}

export interface ExportChildAchievement {
	childRef: string;
	achievementCode: string;
	milestoneValue: number | null;
	unlockedAt: string;
}

export interface ExportChildTitle {
	childRef: string;
	titleCode: string;
	unlockedAt: string;
}

export interface ExportLoginBonus {
	childRef: string;
	loginDate: string;
	rank: string;
	basePoints: number;
	multiplier: number;
	totalPoints: number;
	consecutiveDays: number;
	createdAt: string;
}

export interface ExportEvaluation {
	childRef: string;
	weekStart: string;
	weekEnd: string;
	scoresJson: string;
	bonusPoints: number;
	createdAt: string;
}

export interface ExportSpecialReward {
	childRef: string;
	title: string;
	description: string | null;
	points: number;
	icon: string | null;
	category: string;
	grantedAt: string;
}

export interface ExportChecklistTemplate {
	childRef: string;
	name: string;
	icon: string;
	pointsPerItem: number;
	completionBonus: number;
	isActive: boolean;
	items: ExportChecklistTemplateItem[];
}

export interface ExportChecklistTemplateItem {
	name: string;
	icon: string;
	frequency: string;
	direction: string;
	sortOrder: number;
}

export interface ExportChecklistLog {
	childRef: string;
	templateName: string;
	checkedDate: string;
	itemsJson: string;
	completedAll: boolean;
	pointsAwarded: number;
	createdAt: string;
}

export interface ExportDailyMission {
	childRef: string;
	missionDate: string;
	activityName: string;
	completed: boolean;
	completedAt: string | null;
}

// ============================================================
// ルートエクスポート型
// ============================================================

export interface ExportMasterData {
	categories: ExportCategory[];
	activities: ExportActivity[];
	titles: ExportTitle[];
	achievements: ExportAchievement[];
	avatarItems: never[];
}

export interface ExportTransactionData {
	activityLogs: ExportActivityLog[];
	pointLedger: ExportPointLedger[];
	statuses: ExportStatus[];
	statusHistory: ExportStatusHistory[];
	childAchievements: ExportChildAchievement[];
	childTitles: ExportChildTitle[];
	loginBonuses: ExportLoginBonus[];
	evaluations: ExportEvaluation[];
	specialRewards: ExportSpecialReward[];
	checklistTemplates: ExportChecklistTemplate[];
	checklistLogs: ExportChecklistLog[];
	childAvatarItems: never[];
	dailyMissions: ExportDailyMission[];
}

export interface ExportData {
	format: typeof EXPORT_FORMAT;
	version: string;
	exportedAt: string;
	checksum: string;
	master: ExportMasterData;
	family: {
		children: ExportChild[];
	};
	data: ExportTransactionData;
}

export interface ExportOptions {
	tenantId: string;
	childIds?: number[];
	compact?: boolean;
}
