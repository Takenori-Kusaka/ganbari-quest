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
	uiModeManuallySet: number;
	avatarUrl: string | null;
	displayConfig: string | null;
	userId: string | null;
	birthdayBonusMultiplier: number;
	lastBirthdayBonusYear: number | null;
	isArchived: number;
	archivedReason: string | null;
	createdAt: string;
	updatedAt: string;
}

/**
 * #1755 (#1709-A): activities.priority — 「今日のおやくそく」優先度。
 *
 * - `must`: 今日のおやくそく（保護者が「これは絶対やってほしい」とフラグ立てした活動）。
 *   子供 UI の「今日のおやくそく」セクションに表示され、達成率に応じてボーナスポイントが付与される。
 * - `optional`: ふつうの活動（既定）。通常の活動一覧に表示。
 *
 * 既存レコードは backfill で `'optional'` を設定する（schema default + migrate-local.ts）。
 */
export type ActivityPriority = 'must' | 'optional';

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
	isMainQuest: number;
	isArchived: number;
	archivedReason: string | null;
	createdAt: string;
	// #1254 G1: プリセット非由来は NULL / 未設定
	sourcePresetId?: string | null;
	// #1755 (#1709-A): 「今日のおやくそく」優先度
	priority: ActivityPriority;
}

/**
 * ChildActivity — per-child instance of an activity (#2362 PR-3、ADR-0055)
 *
 * 旧 `Activity` (family-wide master + age filter) を子供別 instance に refactor。
 * `childId NOT NULL` で aggregate root が child に閉じる (ADR-0055 §3.1)。
 *
 * 差分:
 *   - `childId: number` 追加 (NOT NULL)
 *   - `ageMin / ageMax` 削除 (marketplace 側の表示 filter にのみ残す)
 *   - `gradeLevel / subcategory / description` 削除 (使用箇所なしの cleanup)
 *
 * 互換性: PR-3 期間中は `Activity` 並存。次 phase で `Activity` を削除し全 callsite を
 *         `ChildActivity` に切り替える (本 PR の続きで対応)。
 */
export interface ChildActivity {
	id: number;
	childId: number;
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	isVisible: number;
	dailyLimit: number | null;
	sortOrder: number;
	source: string;
	nameKana: string | null;
	nameKanji: string | null;
	triggerHint: string | null;
	isMainQuest: number;
	isArchived: number;
	archivedReason: string | null;
	createdAt: string;
	sourcePresetId?: string | null;
	priority: ActivityPriority;
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
	// #1254 G1: プリセット非由来は NULL / 未設定
	sourcePresetId?: string | null;
	// #3147: ショップ陳列系統 (physical/money/privilege)。null は旧行/未指定で表示側が推定 fallback
	shopCategory?: string | null;
}

/** ごほうびショップ交換申請 (#1337) */
export interface RewardRedemptionRequest {
	id: number;
	childId: number;
	rewardId: number;
	requestedAt: number;
	status: 'pending_parent_approval' | 'approved' | 'rejected' | 'expired';
	parentNote: string | null;
	resolvedAt: number | null;
	resolvedByParentId: string | null;
	shownToChildAt: number | null;
}

export interface InsertRedemptionRequestInput {
	childId: number;
	rewardId: number;
	requestedAt: number;
}

/**
 * #2362 PR-5 (ADR-0055): family master template。
 *   `childId` 列を削除し、配信先 child は `ChecklistTemplateAssignment` で管理。
 *   `tenantId` は scope 物理化 (SQLite 単一テナント時は 'default')。
 */
export interface ChecklistTemplate {
	id: number;
	tenantId: string;
	name: string;
	icon: string;
	pointsPerItem: number;
	completionBonus: number;
	timeSlot: string;
	isActive: number;
	isArchived: number;
	archivedReason: string | null;
	// #1755 (#1709-A): kind 列削除 — 持ち物純化（旧 'routine' は activities.priority='must' に役割移管）
	createdAt: string;
	updatedAt: string;
	// #1254 G1: プリセット非由来は NULL / 未設定
	sourcePresetId?: string | null;
}

/**
 * #2362 PR-5: family checklist (`ChecklistTemplate`) ↔ child の N:M binding。
 * 配信先 child を表す 1 row = 1 配信。配信解除は row 削除。
 */
export interface ChecklistTemplateAssignment {
	id: number;
	templateId: number;
	childId: number;
	createdAt: string;
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
	isMainQuest?: number;
	sourcePresetId?: string | null;
	// #1755 (#1709-A): 「今日のおやくそく」優先度（省略時は schema default の 'optional'）
	priority?: ActivityPriority;
}

export interface UpdateActivityInput {
	name?: string;
	categoryId?: number;
	icon?: string;
	basePoints?: number;
	ageMin?: number | null;
	ageMax?: number | null;
	triggerHint?: string | null;
	isMainQuest?: number;
	// #1755 (#1709-A): 「今日のおやくそく」優先度の変更
	priority?: ActivityPriority;
}

/**
 * #2362 PR-3 (ADR-0055): per-child instance 作成入力。
 * `childId` 必須、`ageMin/ageMax` なし。
 */
export interface InsertChildActivityInput {
	childId: number;
	name: string;
	categoryId: number;
	icon: string;
	basePoints: number;
	triggerHint?: string | null;
	isMainQuest?: number;
	sourcePresetId?: string | null;
	priority?: ActivityPriority;
	// #3358: backup → restore round-trip で表示状態 / 並び順 / アーカイブ状態を保全する
	// (省略時は schema default = 表示 / 並び順 0 / 非アーカイブ)。archived 活動が import 後に
	// active へ復活する silent なデータ破綻 (第10回監査 data-5) を防ぐ。
	isVisible?: number;
	sortOrder?: number;
	isArchived?: number;
	archivedReason?: string | null;
	// #3422: 親が設定する 1 日上限 / 読み仮名 / 漢字表記。child_activities 列は存在するが
	// 旧 service が drop しており常に null (= ProdDashboardSections で dailyLimit ?? 1 固定) だった。
	dailyLimit?: number | null;
	nameKana?: string | null;
	nameKanji?: string | null;
}

export interface UpdateChildActivityInput {
	name?: string;
	categoryId?: number;
	icon?: string;
	basePoints?: number;
	triggerHint?: string | null;
	isMainQuest?: number;
	priority?: ActivityPriority;
	// #3422: dailyLimit / nameKana / nameKanji の編集を persist する (旧実装は silent drop)。
	dailyLimit?: number | null;
	nameKana?: string | null;
	nameKanji?: string | null;
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
	uiModeManuallySet?: number;
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
	sourcePresetId?: string | null;
	// #3147: ショップ陳列系統 (physical/money/privilege)。省略時は表示側 deriveShopCategory に委ねる
	shopCategory?: string | null;
}

export interface InsertStatusHistoryInput {
	childId: number;
	categoryId: number;
	value: number;
	changeAmount: number;
	changeType: string;
}

/**
 * #2362 PR-5 (ADR-0055): family master 化に伴い `childId` を削除。
 *   - 取込/作成時の配信先 child は `assignTemplateToChildren(templateId, childIds, tenantId)` で別途登録する。
 *   - Phase 1 の最小整合では legacy 呼び出し (childId を渡す callsite) で childId を ignore
 *     しつつ後段で assignTemplateToChildren を呼ぶ責務を service 層に持たせる。
 */
export interface InsertChecklistTemplateInput {
	name: string;
	icon?: string;
	pointsPerItem?: number;
	completionBonus?: number;
	timeSlot?: string;
	isActive?: number;
	// #3505 (#3358 と同一クラス): backup → restore round-trip で archive 状態を保全する
	// (省略時は schema default = 非アーカイブ)。archived template が import 後に active へ復活する
	// silent なデータ破綻 (第11回監査 tech-1) を防ぐ。export 契約 (ExportChecklistTemplate) が
	// 出力するのは isArchived のみのため archivedReason は本 input の対象外。
	isArchived?: number;
	// #1755 (#1709-A): kind 削除 — 持ち物純化
	// #1254 G1: マーケットプレイスプリセット由来の識別子
	sourcePresetId?: string | null;
}

export interface UpdateChecklistTemplateInput {
	name?: string;
	icon?: string;
	pointsPerItem?: number;
	completionBonus?: number;
	timeSlot?: string;
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
	// #2267 (EPIC #2266): 応援機能 (cheer) で付与したボーナスポイント (reward_notice タイプのみで使用)
	bonusPoints?: number | null;
	// #2267 (EPIC #2266): 応援機能 (cheer) のカテゴリ (reward_notice タイプのみで使用)
	rewardCategory?: string | null;
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
	// #2267 (EPIC #2266): 応援機能 (cheer) で付与したボーナスポイント (reward_notice のみ使用、null = 旧 stamp/text)
	bonusPoints: number | null;
	// #2267 (EPIC #2266): 応援機能 (cheer) のカテゴリ (reward_notice のみ使用、null = 旧 stamp/text)
	rewardCategory: string | null;
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

// #2295 (EPIC #2294 ①): SeasonEvent / ChildEventProgress / InsertSeasonEventInput /
// UpdateSeasonEventInput / SeasonEventWithProgress 型削除済 (2026-05-19)
// Research 2 段階で ADR-0012 / ADR-0013 二重違反として完全撤去。

// ============================================================
// Sibling Challenge — #2458 (Path B sibling drop) で物理 drop 済 (2026-05-26)
// ============================================================
// 旧 SiblingChallenge / SiblingChallengeProgress / InsertSiblingChallengeInput /
// UpdateSiblingChallengeInput / SiblingChallengeWithProgress 型は撤去済。
// per-child ChildChallenge 型へ完全移行 (ADR-0055 / User §6)。

// ============================================================
// ChildChallenge — per-child instance of a challenge (#2362 PR-7、ADR-0055、User §6)
// ============================================================
//
// 旧 `sibling_challenges` (family-wide + sibling_challenge_progress) を per-child instance に flip。
// 兄弟連動 UI は `sourceTemplateId` でグルーピングし `SiblingChallengeComparison` で表示する。

export interface ChildChallenge {
	id: number;
	childId: number;
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
	sourceTemplateId: string | null;
	currentValue: number;
	targetValue: number;
	completed: number;
	completedAt: string | null;
	rewardClaimed: number;
	rewardClaimedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface InsertChildChallengeInput {
	childId: number;
	title: string;
	description?: string | null;
	challengeType?: string;
	periodType?: string;
	startDate: string;
	endDate: string;
	targetConfig: string;
	rewardConfig: string;
	sourceTemplateId?: string | null;
	targetValue: number;
}

export interface UpdateChildChallengeInput {
	title?: string;
	description?: string | null;
	periodType?: string;
	startDate?: string;
	endDate?: string;
	targetConfig?: string;
	rewardConfig?: string;
	status?: string;
	isActive?: number;
}

/**
 * 兄弟連動表示用: 同じ sourceTemplateId / 同じタイトル + 同期間で
 * 複数 child instance を group したビュー。
 * admin/challenges 画面の SiblingChallengeComparison で利用。
 */
export interface ChildChallengeGroup {
	/** group キー: sourceTemplateId があればそれ、なければ `${title}::${startDate}::${endDate}` */
	groupKey: string;
	title: string;
	description: string | null;
	startDate: string;
	endDate: string;
	periodType: string;
	sourceTemplateId: string | null;
	/** group 内の各 child instance (1 件 = 1 child の challenge instance) */
	instances: ChildChallenge[];
	/** group 全員 (instances.length 件) が completed === 1 になっているか */
	allCompleted: boolean;
}

/**
 * #2458-B (sibling-challenges caller migration):
 * 子供画面 (home / history) で表示する per-child challenge instance + 兄弟連動情報。
 *
 * 旧 `SiblingChallengeWithProgress` (family-wide + progress[] 配列) の per-child 後継。
 * 自身の instance を主軸に、同じ sourceTemplateId / (title + 期間) を共有する
 * 兄弟 instance を `siblings` として併記する。CategorySection のチャレンジ対象バッジ
 * (#3333 で旧 ChallengeBanner から移行) と `SiblingCelebration` が「自分の進捗 + 兄弟の進捗 +
 * 全員完了で celebration」の UX を継続できる。
 */
export interface ChildChallengeWithSiblings extends ChildChallenge {
	/**
	 * 同じ sourceTemplateId / (title + 期間) を共有する兄弟 instance (自身を含む)。
	 * 自身のみ存在する (兄弟が居ない / sourceTemplateId が独立) 場合は length === 1。
	 */
	siblings: ChildChallenge[];
	/** siblings 全員 (length 件) が completed === 1 か */
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

/**
 * Push 通知購読者ロール (#1593 ADR-0023 I6)
 *
 * `'child'` は subscribe 自体を拒否する設計のため型に含めない。
 * 既存レコード backfill 用 default は `'parent'`（schema.ts 参照）。
 * COPPA 改正 + ADR-0012 Anti-engagement 二重リスク対策。
 */
export type PushSubscriberRole = 'parent' | 'owner';

export interface PushSubscriptionRecord {
	id: number;
	tenantId: string;
	endpoint: string;
	keysP256dh: string;
	keysAuth: string;
	userAgent: string | null;
	subscriberRole: PushSubscriberRole;
	createdAt: string;
}

export interface InsertPushSubscriptionInput {
	tenantId: string;
	endpoint: string;
	keysP256dh: string;
	keysAuth: string;
	userAgent?: string | null;
	subscriberRole: PushSubscriberRole;
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

// #1816 (2026-05-01): CustomAchievement / InsertCustomAchievementInput / CustomAchievementConditionType を削除
// #1782 で service 層削除済み、本 Issue で type も dead code として削除。

// ============================================================
// Certificates
// ============================================================

export interface Certificate {
	id: number;
	childId: number;
	tenantId: string;
	certificateType: string;
	title: string;
	description: string | null;
	issuedAt: string;
	metadata: string | null;
}

export interface InsertCertificateInput {
	childId: number;
	certificateType: string;
	title: string;
	description?: string;
	metadata?: string;
}

// ============================================================
// Cloud Exports (クラウドエクスポート共有)
// ============================================================

export type CloudExportType = 'template' | 'full';

export interface CloudExportRecord {
	id: number;
	tenantId: string;
	exportType: CloudExportType;
	pinCode: string;
	s3Key: string;
	fileSizeBytes: number;
	label: string | null;
	description: string | null;
	expiresAt: string;
	downloadCount: number;
	maxDownloads: number;
	createdAt: string;
}

export interface InsertCloudExportInput {
	tenantId: string;
	exportType: CloudExportType;
	pinCode: string;
	s3Key: string;
	fileSizeBytes: number;
	label?: string | null;
	description?: string | null;
	expiresAt: string;
	maxDownloads?: number;
}

// #2295 (EPIC #2294 ①): TenantEvent / InsertTenantEventInput / UpdateTenantEventInput /
// TenantEventProgress / UpsertTenantEventProgressInput 型削除済 (2026-05-19)

// #3213 (EPIC #3193): AutoChallenge / AutoChallengeStatus / AutoChallengeMode /
// InsertAutoChallengeInput / UpdateAutoChallengeInput 型削除済。週次自動生成チャレンジは
// child_challenges へ一本化され (#3195)、生成アルゴリズムが使う最小 prev 型は
// child-challenge-service.ts の ChallengePrev へ移設した。

// ============================================================
// Viewer Tokens (閲覧専用リンク #371)
// ============================================================

export interface ViewerToken {
	id: number;
	tenantId: string;
	token: string;
	label: string | null;
	expiresAt: string | null;
	createdAt: string;
	revokedAt: string | null;
}

export interface InsertViewerTokenInput {
	token: string;
	label?: string | null;
	expiresAt?: string | null;
}

// ============================================================
// Daily Battles (バトルアドベンチャー #605)
// ============================================================

export interface DailyBattleRecord {
	id: number;
	childId: number;
	enemyId: number;
	date: string;
	status: 'pending' | 'completed';
	outcome: 'win' | 'lose' | null;
	rewardPoints: number;
	turnsUsed: number;
	playerStatsJson: string;
	createdAt: string;
	updatedAt: string;
}

export interface EnemyCollectionRecord {
	id: number;
	childId: number;
	enemyId: number;
	firstDefeatedAt: string;
	defeatCount: number;
}
