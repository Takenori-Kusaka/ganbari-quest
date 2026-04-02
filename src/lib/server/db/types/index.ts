// src/lib/server/db/types/index.ts
// Drizzle-independent entity / input / projection types for dual-backend support

// ============================================================
// Entity Types (DB read — full row)
// ============================================================

export interface Category {
	id: number;
	code: string;
	name: string;
	icon: string | null;
	color: string | null;
}

export interface Child {
	id: number;
	nickname: string;
	age: number;
	birthDate: string | null;
	theme: string;
	uiMode: string;
	avatarUrl: string | null;
	activeTitleId: number | null;
	displayConfig: string | null;
	userId: string | null;
	birthdayBonusMultiplier: number;
	lastBirthdayBonusYear: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface Activity {
	id: number;
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	ageMin: number | null;
	ageMax: number | null;
	isVisible: number;
	dailyLimit: number | null;
	sortOrder: number;
	source: string;
	gradeLevel: string | null;
	subcategory: string | null;
	description: string | null;
	nameKana: string | null;
	nameKanji: string | null;
	triggerHint: string | null;
	createdAt: string;
}

export interface ActivityLog {
	id: number;
	childId: number;
	activityId: number;
	points: number;
	streakDays: number;
	streakBonus: number;
	recordedDate: string;
	recordedAt: string;
	cancelled: number;
}

export interface PointLedgerEntry {
	id: number;
	childId: number;
	amount: number;
	type: string;
	description: string | null;
	referenceId: number | null;
	createdAt: string;
}

export interface Status {
	id: number;
	childId: number;
	categoryId: number;
	totalXp: number;
	level: number;
	peakXp: number;
	updatedAt: string;
}

export interface StatusHistoryEntry {
	id: number;
	childId: number;
	categoryId: number;
	value: number;
	changeAmount: number;
	changeType: string;
	recordedAt: string;
}

export interface Evaluation {
	id: number;
	childId: number;
	weekStart: string;
	weekEnd: string;
	scoresJson: string;
	bonusPoints: number;
	createdAt: string;
}

export interface MarketBenchmark {
	id: number;
	age: number;
	categoryId: number;
	mean: number;
	stdDev: number;
	source: string | null;
	updatedAt: string;
}

export interface Setting {
	key: string;
	value: string;
	updatedAt: string;
}

export interface RestDay {
	id: number;
	childId: number;
	date: string;
	reason: string;
	createdAt: string;
}

export interface CharacterImage {
	id: number;
	childId: number;
	type: string;
	filePath: string;
	promptHash: string | null;
	generatedAt: string;
}

export interface LoginBonus {
	id: number;
	childId: number;
	loginDate: string;
	rank: string;
	basePoints: number;
	multiplier: number;
	totalPoints: number;
	consecutiveDays: number;
	createdAt: string;
}

export interface Achievement {
	id: number;
	code: string;
	name: string;
	description: string | null;
	icon: string;
	category: string | null;
	conditionType: string;
	conditionValue: number;
	bonusPoints: number;
	rarity: string;
	sortOrder: number;
	repeatable: number;
	milestoneValues: string | null;
	isMilestone: number;
	createdAt: string;
}

export interface ChildAchievement {
	id: number;
	childId: number;
	achievementId: number;
	milestoneValue: number | null;
	unlockedAt: string;
}

export interface SpecialReward {
	id: number;
	childId: number;
	grantedBy: number | null;
	title: string;
	description: string | null;
	points: number;
	icon: string | null;
	category: string;
	grantedAt: string;
	shownAt: string | null;
}

export interface ChecklistTemplate {
	id: number;
	childId: number;
	name: string;
	icon: string;
	pointsPerItem: number;
	completionBonus: number;
	isActive: number;
	createdAt: string;
	updatedAt: string;
}

export interface ChecklistTemplateItem {
	id: number;
	templateId: number;
	name: string;
	icon: string;
	frequency: string;
	direction: string;
	sortOrder: number;
	createdAt: string;
}

export interface ChecklistLog {
	id: number;
	childId: number;
	templateId: number;
	checkedDate: string;
	itemsJson: string;
	completedAll: number;
	pointsAwarded: number;
	createdAt: string;
}

export interface ChecklistOverride {
	id: number;
	childId: number;
	targetDate: string;
	action: string;
	itemName: string;
	icon: string;
	createdAt: string;
}

export interface BirthdayReview {
	id: number;
	childId: number;
	reviewYear: number;
	ageAtReview: number;
	healthChecks: string;
	aspirationText: string | null;
	aspirationCategories: string;
	basePoints: number;
	healthPoints: number;
	aspirationPoints: number;
	totalPoints: number;
	createdAt: string;
}

export interface DailyMission {
	id: number;
	childId: number;
	missionDate: string;
	activityId: number;
	completed: number;
	completedAt: string | null;
}

export interface Title {
	id: number;
	code: string;
	name: string;
	description: string | null;
	icon: string;
	conditionType: string;
	conditionValue: number;
	conditionExtra: string | null;
	rarity: string;
	sortOrder: number;
	createdAt: string;
}

export interface ChildTitle {
	id: number;
	childId: number;
	titleId: number;
	unlockedAt: string;
}

// ============================================================
// Input Types (DB write)
// ============================================================

export interface InsertActivityInput {
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	ageMin: number | null;
	ageMax: number | null;
	triggerHint?: string | null;
}

export interface UpdateActivityInput {
	name?: string;
	categoryId?: number;
	icon?: string;
	basePoints?: number;
	ageMin?: number | null;
	ageMax?: number | null;
	triggerHint?: string | null;
}

export interface InsertActivityLogInput {
	childId: number;
	activityId: number;
	points: number;
	streakDays: number;
	streakBonus: number;
	recordedDate: string;
	recordedAt: string;
}

export interface InsertPointLedgerInput {
	childId: number;
	amount: number;
	type: string;
	description: string;
	referenceId?: number;
}

export interface InsertChildInput {
	nickname: string;
	age: number;
	theme?: string;
	uiMode?: string;
	birthDate?: string;
}

export interface UpdateChildInput {
	nickname?: string;
	age?: number;
	theme?: string;
	uiMode?: string;
	birthDate?: string | null;
	displayConfig?: string | null;
	userId?: string | null;
	birthdayBonusMultiplier?: number;
	lastBirthdayBonusYear?: number | null;
}

export interface InsertEvaluationInput {
	childId: number;
	weekStart: string;
	weekEnd: string;
	scoresJson: string;
	bonusPoints: number;
}

export interface InsertLoginBonusInput {
	childId: number;
	loginDate: string;
	rank: string;
	basePoints: number;
	multiplier: number;
	totalPoints: number;
	consecutiveDays: number;
}

export interface InsertSpecialRewardInput {
	childId: number;
	grantedBy?: number | null;
	title: string;
	description?: string;
	points: number;
	icon?: string;
	category: string;
}

export interface InsertStatusHistoryInput {
	childId: number;
	categoryId: number;
	value: number;
	changeAmount: number;
	changeType: string;
}

export interface InsertChecklistTemplateInput {
	childId: number;
	name: string;
	icon?: string;
	pointsPerItem?: number;
	completionBonus?: number;
	isActive?: number;
}

export interface UpdateChecklistTemplateInput {
	name?: string;
	icon?: string;
	pointsPerItem?: number;
	completionBonus?: number;
	isActive?: number;
}

export interface InsertChecklistTemplateItemInput {
	templateId: number;
	name: string;
	icon?: string;
	frequency?: string;
	direction?: string;
	sortOrder?: number;
}

export interface UpsertChecklistLogInput {
	childId: number;
	templateId: number;
	checkedDate: string;
	itemsJson: string;
	completedAll: number;
	pointsAwarded: number;
}

export interface InsertChecklistOverrideInput {
	childId: number;
	targetDate: string;
	action: string;
	itemName: string;
	icon?: string;
}

export interface InsertBirthdayReviewInput {
	childId: number;
	reviewYear: number;
	ageAtReview: number;
	healthChecks: string;
	aspirationText: string | null;
	aspirationCategories: string;
	basePoints: number;
	healthPoints: number;
	aspirationPoints: number;
	totalPoints: number;
}

export interface InsertParentMessageInput {
	childId: number;
	messageType: string;
	stampCode?: string | null;
	body?: string | null;
	icon?: string;
}

export interface InsertCharacterImageInput {
	childId: number;
	type: string;
	filePath: string;
	promptHash: string;
}

// ============================================================
// Query / Filter Types
// ============================================================

export interface ActivityFilter {
	childAge?: number;
	categoryId?: number;
	includeHidden?: boolean;
}

// ============================================================
// Projection Types (partial entity reads)
// ============================================================

export interface ActivityLogSummary {
	id: number;
	activityName: string;
	activityIcon: string;
	categoryId: number;
	points: number;
	streakDays: number;
	streakBonus: number;
	recordedAt: string;
}

export interface DailyMissionWithActivity {
	id: number;
	activityId: number;
	completed: number;
	activityName: string;
	activityIcon: string;
	categoryId: number;
}

export interface CategoryActivityCount {
	categoryId: number;
	count: number;
	totalPoints: number;
}

export interface CategoryLastDate {
	categoryId: number;
	lastDate: string;
}

// ============================================================
// Child Activity Preferences (ピン留め)
// ============================================================

export interface ChildActivityPreference {
	id: number;
	childId: number;
	activityId: number;
	isPinned: number;
	pinOrder: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface ActivityUsageCount {
	activityId: number;
	usageCount: number;
}

// ============================================================
// Activity Mastery (活動別習熟度)
// ============================================================

export interface ActivityMastery {
	id: number;
	childId: number;
	activityId: number;
	totalCount: number;
	level: number;
	updatedAt: string;
}

export interface ChildCustomVoice {
	id: number;
	childId: number;
	scene: string;
	label: string;
	filePath: string;
	publicUrl: string;
	durationMs: number | null;
	isActive: number;
	tenantId: string;
	createdAt: string;
}

export interface ParentMessage {
	id: number;
	childId: number;
	messageType: string;
	stampCode: string | null;
	body: string | null;
	icon: string;
	sentAt: string;
	shownAt: string | null;
}

export interface LevelTitle {
	id: number;
	tenantId: string;
	level: number;
	customTitle: string;
	updatedAt: string;
}

// ============================================================
// Stamp Card / Stamp Master / Stamp Entry
// ============================================================

export interface StampMaster {
	id: number;
	name: string;
	emoji: string;
	rarity: string;
	isDefault: number;
	isEnabled: number;
	createdAt: string;
	updatedAt: string;
}

export interface StampCard {
	id: number;
	childId: number;
	weekStart: string;
	weekEnd: string;
	status: string;
	redeemedPoints: number | null;
	redeemedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface StampEntry {
	id: number;
	cardId: number;
	stampMasterId: number | null;
	omikujiRank: string | null;
	slot: number;
	loginDate: string;
	earnedAt: string;
}

export interface StampEntryWithMaster {
	slot: number;
	stampMasterId: number | null;
	omikujiRank: string | null;
	loginDate: string;
	name: string | null;
	emoji: string | null;
	rarity: string | null;
}

export interface InsertStampCardInput {
	childId: number;
	weekStart: string;
	weekEnd: string;
	status?: string;
}

export interface InsertStampEntryInput {
	cardId: number;
	stampMasterId: number;
	omikujiRank: string | null;
	slot: number;
	loginDate: string;
}

export interface UpdateStampCardStatusInput {
	status: string;
	redeemedPoints: number | null;
	redeemedAt: string | null;
	updatedAt: string;
}

// ============================================================
// Season Events
// ============================================================

export interface SeasonEvent {
	id: number;
	code: string;
	name: string;
	description: string | null;
	eventType: string;
	startDate: string;
	endDate: string;
	bannerIcon: string;
	bannerColor: string | null;
	themeConfig: string | null;
	rewardConfig: string | null;
	missionConfig: string | null;
	isActive: number;
	createdAt: string;
	updatedAt: string;
}

export interface ChildEventProgress {
	id: number;
	childId: number;
	eventId: number;
	status: string;
	progressJson: string | null;
	rewardClaimedAt: string | null;
	joinedAt: string;
	updatedAt: string;
}

export interface InsertSeasonEventInput {
	code: string;
	name: string;
	description?: string | null;
	eventType?: string;
	startDate: string;
	endDate: string;
	bannerIcon?: string;
	bannerColor?: string | null;
	themeConfig?: string | null;
	rewardConfig?: string | null;
	missionConfig?: string | null;
}

export interface UpdateSeasonEventInput {
	name?: string;
	description?: string | null;
	eventType?: string;
	startDate?: string;
	endDate?: string;
	bannerIcon?: string;
	bannerColor?: string | null;
	themeConfig?: string | null;
	rewardConfig?: string | null;
	missionConfig?: string | null;
	isActive?: number;
}

export interface SeasonEventWithProgress extends SeasonEvent {
	progress: ChildEventProgress | null;
}

// ============================================================
// Sibling Challenge
// ============================================================

export interface SiblingChallenge {
	id: number;
	title: string;
	description: string | null;
	challengeType: string;
	periodType: string;
	startDate: string;
	endDate: string;
	targetConfig: string;
	rewardConfig: string;
	status: string;
	isActive: number;
	createdAt: string;
	updatedAt: string;
}

export interface SiblingChallengeProgress {
	id: number;
	challengeId: number;
	childId: number;
	currentValue: number;
	targetValue: number;
	completed: number;
	completedAt: string | null;
	rewardClaimed: number;
	rewardClaimedAt: string | null;
	progressJson: string | null;
	updatedAt: string;
}

export interface InsertSiblingChallengeInput {
	title: string;
	description?: string | null;
	challengeType?: string;
	periodType?: string;
	startDate: string;
	endDate: string;
	targetConfig: string;
	rewardConfig: string;
}

export interface UpdateSiblingChallengeInput {
	title?: string;
	description?: string | null;
	challengeType?: string;
	startDate?: string;
	endDate?: string;
	targetConfig?: string;
	rewardConfig?: string;
	status?: string;
	isActive?: number;
}

export interface SiblingChallengeWithProgress extends SiblingChallenge {
	progress: SiblingChallengeProgress[];
	allCompleted: boolean;
}

// ============================================================
// Sibling Cheers (きょうだい間おうえんスタンプ)
// ============================================================

export interface SiblingCheer {
	id: number;
	fromChildId: number;
	toChildId: number;
	stampCode: string;
	tenantId: string;
	sentAt: string;
	shownAt: string | null;
}

export interface InsertSiblingCheerInput {
	fromChildId: number;
	toChildId: number;
	stampCode: string;
}

// ============================================================
// Push Subscriptions (プッシュ通知購読)
// ============================================================

export interface PushSubscriptionRecord {
	id: number;
	tenantId: string;
	endpoint: string;
	keysP256dh: string;
	keysAuth: string;
	userAgent: string | null;
	createdAt: string;
}

export interface InsertPushSubscriptionInput {
	tenantId: string;
	endpoint: string;
	keysP256dh: string;
	keysAuth: string;
	userAgent?: string | null;
}

// ============================================================
// Notification Logs (通知送信ログ)
// ============================================================

export interface NotificationLog {
	id: number;
	tenantId: string;
	notificationType: string;
	title: string;
	body: string;
	sentAt: string;
	success: number;
	errorMessage: string | null;
}

export interface InsertNotificationLogInput {
	tenantId: string;
	notificationType: string;
	title: string;
	body: string;
	success: boolean;
	errorMessage?: string | null;
}

// ============================================================
// Report Daily Summary
// ============================================================

export interface ReportDailySummary {
	id: number;
	tenantId: string;
	childId: number;
	date: string;
	activityCount: number;
	categoryBreakdown: string;
	checklistCompletion: string;
	level: number;
	totalPoints: number;
	streakDays: number;
	newAchievements: number;
	createdAt: string;
}

export interface InsertReportDailySummaryInput {
	tenantId: string;
	childId: number;
	date: string;
	activityCount: number;
	categoryBreakdown: string;
	checklistCompletion: string;
	level: number;
	totalPoints: number;
	streakDays: number;
	newAchievements: number;
}
