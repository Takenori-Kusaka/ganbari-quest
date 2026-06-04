// src/lib/server/db/dynamodb/keys.ts
// PK/SK generation helpers for single-table design
// All entity keys are defined here for type-safe, consistent key construction.

import { createHash } from 'node:crypto';

// ============================================================
// Numeric ID padding (8 digits for lexicographic sort)
// ============================================================

const ID_PAD_LENGTH = 8;

/** Pad a numeric ID to 8 digits for proper lexicographic ordering in sort keys. */
export function padId(id: number): string {
	return String(id).padStart(ID_PAD_LENGTH, '0');
}

// ============================================================
// Key prefixes (constants for compile-time safety)
// ============================================================

const PREFIX = {
	CHILD: 'CHILD',
	CATEGORY: 'CATEGORY',
	ACTIVITY: 'ACTIVITY',
	ACHIEVEMENT: 'ACHIEVEMENT',
	TITLE: 'TITLE',
	SETTING: 'SETTING',
	COUNTER: 'COUNTER',
	CKTPL: 'CKTPL',
	BENCH: 'BENCH',
	INQUIRY: 'INQUIRY',
	PUSH_SUB: 'PUSH_SUB',
	NOTIF_LOG: 'NOTIF_LOG',
} as const;

// ============================================================
// Key type definitions
// ============================================================

export interface DynamoKey {
	PK: string;
	SK: string;
}

export interface DynamoKeyWithGSI2 extends DynamoKey {
	GSI2PK: string;
	GSI2SK: string;
}

// ============================================================
// Tenant prefix helper
// ============================================================

/** Wrap a PK with tenant prefix. */
export function tenantPK(pk: string, tenantId: string): string {
	return `T#${tenantId}#${pk}`;
}

// ============================================================
// Entity key builders — Tenant-scoped
// ============================================================

/** Child profile: PK=CHILD#<id>, SK=PROFILE */
export function childKey(childId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: 'PROFILE',
	};
}

/** Activity master: PK=ACTIVITY#<id>, SK=MASTER */
export function activityKey(activityId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.ACTIVITY}#${activityId}`, tenantId),
		SK: 'MASTER',
	};
}

/**
 * Activity master with GSI2 keys for category-based queries.
 * GSI2PK=CAT#<catId>, GSI2SK=ACT#<sort>#<id>
 */
export function activityKeyWithGSI2(
	activityId: number,
	categoryId: number,
	sortOrder: number,
	tenantId: string,
): DynamoKeyWithGSI2 {
	return {
		...activityKey(activityId, tenantId),
		GSI2PK: tenantPK(`CAT#${categoryId}`, tenantId),
		GSI2SK: `ACT#${padId(sortOrder)}#${padId(activityId)}`,
	};
}

/**
 * Child activity instance (#2362 PR-3 / ADR-0055): PK=CHILD#<cId>, SK=CHILDACT#<id>
 *
 * per-child instance を child partition 配下に配置する (activity_logs / point_ledger /
 * status 等と同じ child scope レイアウト)。これにより `findActivitiesByChild` は
 * 単一 partition Query (begins_with(SK, 'CHILDACT#')) で完結し、GSI を追加せず
 * cross-child access を構造的に防ぐ (ADR-0055 §3.1)。
 *
 * 旧 family-master `ACTIVITY#<id>` (SK=MASTER) とは別 partition のため、移行中も
 * 名前空間が衝突しない。SQLite `child_activities` table と機能等価。
 */
export function childActivityKey(childId: number, activityId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `CHILDACT#${padId(activityId)}`,
	};
}

/** Child activity SK prefix for querying all activities of a child */
export function childActivityPrefix(): string {
	return 'CHILDACT#';
}

/**
 * Child challenge instance (#2362 PR-7 / ADR-0055): PK=CHILD#<cId>, SK=CHILDCHAL#<id>
 *
 * per-child challenge instance を child partition 配下に配置する (child_activities /
 * activity_logs 等と同じ child scope レイアウト)。これにより `findByChildId` は
 * 単一 partition Query (begins_with(SK, 'CHILDCHAL#')) で完結し、GSI を追加せず
 * cross-child access を構造的に防ぐ (ADR-0055 §3.1)。
 *
 * SQLite `child_challenges` table と機能等価。childActivityKey と同型 (Phase 1 #2820)。
 */
export function childChallengeKey(
	childId: number,
	challengeId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `CHILDCHAL#${padId(challengeId)}`,
	};
}

/** Child challenge SK prefix for querying all challenges of a child */
export function childChallengePrefix(): string {
	return 'CHILDCHAL#';
}

/** Activity log: PK=CHILD#<cId>, SK=LOG#<date>#<id> */
export function activityLogKey(
	childId: number,
	recordedDate: string,
	logId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `LOG#${recordedDate}#${padId(logId)}`,
	};
}

/** Activity log SK prefix for querying all logs of a child */
export function activityLogPrefix(): string {
	return 'LOG#';
}

/** Activity log SK prefix for querying logs by date */
export function activityLogDatePrefix(date: string): string {
	return `LOG#${date}#`;
}

/** Point ledger entry: PK=CHILD#<cId>, SK=POINT#<ts>#<id> */
export function pointLedgerKey(
	childId: number,
	createdAt: string,
	ledgerId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `POINT#${createdAt}#${padId(ledgerId)}`,
	};
}

/** Point ledger SK prefix for querying all points of a child */
export function pointLedgerPrefix(): string {
	return 'POINT#';
}

/** Point balance (aggregated): PK=CHILD#<cId>, SK=BALANCE */
export function pointBalanceKey(childId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: 'BALANCE',
	};
}

/** Status: PK=CHILD#<cId>, SK=STATUS#<catId> */
export function statusKey(childId: number, categoryId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `STATUS#${padId(categoryId)}`,
	};
}

/** Status SK prefix for querying all statuses of a child */
export function statusPrefix(): string {
	return 'STATUS#';
}

/** Status history: PK=CHILD#<cId>, SK=STATHIST#<catId>#<ts>#<id> */
export function statusHistoryKey(
	childId: number,
	categoryId: number,
	recordedAt: string,
	historyId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `STATHIST#${padId(categoryId)}#${recordedAt}#${padId(historyId)}`,
	};
}

/** Status history SK prefix for querying by category */
export function statusHistoryByCategoryPrefix(categoryId: number): string {
	return `STATHIST#${padId(categoryId)}#`;
}

/** Status history SK prefix for querying all history of a child */
export function statusHistoryPrefix(): string {
	return 'STATHIST#';
}

// ============================================================
// Entity key builders — Global (no tenant prefix)
// ============================================================

/** Category master: PK=CATEGORY#<id>, SK=MASTER */
export function categoryKey(categoryId: number): DynamoKey {
	return {
		PK: `${PREFIX.CATEGORY}#${categoryId}`,
		SK: 'MASTER',
	};
}

/** Achievement master: PK=ACHIEVEMENT#<id>, SK=MASTER */
export function achievementKey(achievementId: number): DynamoKey {
	return {
		PK: `${PREFIX.ACHIEVEMENT}#${achievementId}`,
		SK: 'MASTER',
	};
}

/** Child achievement: PK=CHILD#<cId>, SK=ACHV#<achvId>#<milestone> */
export function childAchievementKey(
	childId: number,
	achievementId: number,
	tenantId: string,
	milestoneValue?: number | null,
): DynamoKey {
	const ms = milestoneValue != null ? String(milestoneValue) : '0';
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `ACHV#${padId(achievementId)}#${ms}`,
	};
}

/** Child achievement SK prefix for querying all achievements of a child */
export function childAchievementPrefix(): string {
	return 'ACHV#';
}

/** Title master: PK=TITLE#<id>, SK=MASTER */
export function titleKey(titleId: number): DynamoKey {
	return {
		PK: `${PREFIX.TITLE}#${titleId}`,
		SK: 'MASTER',
	};
}

/** Child title: PK=CHILD#<cId>, SK=TITLE#<tId> */
export function childTitleKey(childId: number, titleId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `TITLE#${padId(titleId)}`,
	};
}

/** Child title SK prefix for querying all titles of a child */
export function childTitlePrefix(): string {
	return 'TITLE#';
}

/** Login bonus: PK=CHILD#<cId>, SK=LOGIN#<date> */
export function loginBonusKey(childId: number, loginDate: string, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `LOGIN#${loginDate}`,
	};
}

/** Login bonus SK prefix for querying all bonuses of a child */
export function loginBonusPrefix(): string {
	return 'LOGIN#';
}

/** Setting: PK=SETTING, SK=<key> */
export function settingKey(key: string, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(PREFIX.SETTING, tenantId),
		SK: key,
	};
}

/** Evaluation: PK=CHILD#<cId>, SK=EVAL#<weekStart> */
export function evaluationKey(childId: number, weekStart: string, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `EVAL#${weekStart}`,
	};
}

/** Evaluation SK prefix for querying all evaluations of a child */
export function evaluationPrefix(): string {
	return 'EVAL#';
}

/** Special reward: PK=CHILD#<cId>, SK=REWARD#<ts>#<id> */
export function specialRewardKey(
	childId: number,
	grantedAt: string,
	rewardId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `REWARD#${grantedAt}#${padId(rewardId)}`,
	};
}

/** Special reward SK prefix for querying all rewards of a child */
export function specialRewardPrefix(): string {
	return 'REWARD#';
}

/**
 * Reward redemption request (#1337 / #2824 Phase 2A / ADR-0055):
 *   PK = T#<tenantId>#CHILD#<childId>, SK = REDEMPT#<paddedId>
 *
 * per-child instance を child partition 配下に置き (special_rewards / activity_logs と同居)、
 * `findRedemptionRequestsByChild` を単一 partition Query (begins_with(SK, 'REDEMPT#')) で
 * 完結させる。child 軸を構造的に担保し追加 GSI 不要 (ADR-0055 §3.1)。
 */
export function rewardRedemptionKey(
	childId: number,
	requestId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `REDEMPT#${padId(requestId)}`,
	};
}

/** Reward redemption SK prefix for querying all requests of a child */
export function rewardRedemptionPrefix(): string {
	return 'REDEMPT#';
}

/**
 * Parent message (#2266 / #2824 Wave 3A / ADR-0055):
 *   PK = T#<tenantId>#CHILD#<childId>, SK = MSG#<paddedId>
 *
 * おうえんメッセージ (親→子) を child partition 配下に置き (activity_logs / point_ledger と同居)、
 * `findMessages` / `findUnshownMessage` / `countUnshownMessages` を単一 partition Query
 * (begins_with(SK, 'MSG#')) で完結させる。read は全て child 軸のため追加 GSI 不要 (ADR-0055 §3.1)。
 * `markMessageShown` は messageId のみ受けるため tenant Scan + id filter で 1 件特定する
 * (reward-redemption-repo.findRedemptionItemById と同じパターン、低頻度経路)。
 */
export function parentMessageKey(childId: number, messageId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `MSG#${padId(messageId)}`,
	};
}

/** Parent message SK prefix for querying all messages of a child */
export function parentMessagePrefix(): string {
	return 'MSG#';
}

/**
 * Stamp card (#2824 Wave 3B / ADR-0055): PK=CHILD#<cId>, SK=STMPCARD#<weekStart>
 *
 * per-child instance を child partition 配下に置き (special_rewards / activity_logs と同居)、
 * `findCardByChildAndWeek` を childId + weekStart 既知の GetItem 1 回で完結させる
 * (weekStart は child 内で一意 = SQLite uniqueIndex(child_id, week_start) と等価)。
 * child 軸を構造的に担保し追加 GSI 不要 (ADR-0055 §3.1)。cardId だけで引く
 * updateCardStatus* は低頻度 (週次 redeem) のため tenant Scan + id filter で解決する。
 */
export function stampCardKey(childId: number, weekStart: string, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `STMPCARD#${weekStart}`,
	};
}

/** Stamp card SK prefix for querying all cards of a child / tenant cleanup */
export function stampCardPrefix(): string {
	return 'STMPCARD#';
}

/**
 * Stamp entry (#2824 Wave 3B / ADR-0055): PK=STMPCARD#<cardId>, SK=STMPENT#<paddedSlot>
 *
 * entry は cardId だけで lookup される (`findEntriesWithMasterByCardId(cardId)` に childId が
 * 渡らない) ため、card 自身を partition key にした専用 partition へ配置する。これにより
 * 単一 partition Query (begins_with(SK, 'STMPENT#')) で全 entry を取得でき GSI 不要。
 * SK の paddedSlot は SQLite uniqueIndex(card_id, slot) と等価 (slot は週内 1〜5 枠で一意)。
 * stamp master との JOIN は固定 16 件 SSOT (getDefaultStampMasters) を in-memory で解決する。
 */
export function stampEntryKey(cardId: number, slot: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`STMPCARD#${cardId}`, tenantId),
		SK: `STMPENT#${padId(slot)}`,
	};
}

/** Stamp entry partition PK for a given card (Query all entries of a card). */
export function stampEntryCardPK(cardId: number, tenantId: string): string {
	return tenantPK(`STMPCARD#${cardId}`, tenantId);
}

/** Stamp entry SK prefix for querying all entries of a card. */
export function stampEntryPrefix(): string {
	return 'STMPENT#';
}

/**
 * Daily battle (#2824 Wave 5A / ADR-0055): PK=CHILD#<cId>, SK=BATTLE#<date>
 *
 * per-child instance を child partition 配下に置き (stamp_cards / activity_logs と同居)、
 * `findTodayBattle` を childId + date 既知の GetItem 1 回で完結させる
 * (date は child 内で一意 = SQLite uniqueIndex(child_id, date) と等価)。`findRecentBattles` /
 * `countConsecutiveLosses` は child partition の begins_with(SK, 'BATTLE#') Query で取得し
 * (date は YYYY-MM-DD で SK 辞書順 = 日付順)、追加 GSI 不要 (ADR-0055 §3.1)。
 * battleId だけで引く `completeBattle` は 1 日 1 戦の低頻度のため tenant Scan + id filter で解決する。
 */
export function dailyBattleKey(childId: number, date: string, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `BATTLE#${date}`,
	};
}

/** Daily battle SK prefix for querying all battles of a child / tenant cleanup. */
export function dailyBattlePrefix(): string {
	return 'BATTLE#';
}

/**
 * Enemy collection (#2824 Wave 5A / ADR-0055): PK=CHILD#<cId>, SK=ENEMYCOL#<paddedEnemyId>
 *
 * per-child 敵図鑑を child partition 配下に置く。`findCollection` は child partition の
 * begins_with(SK, 'ENEMYCOL#') Query で全件取得、`upsertCollectionEntry` は childId + enemyId
 * 既知の GetItem → 不在なら Put / 既存なら defeatCount を ADD する (childId が常に渡るため
 * Scan 不要)。SK の paddedEnemyId は SQLite uniqueIndex(child_id, enemy_id) と等価。
 */
export function enemyCollectionKey(childId: number, enemyId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `ENEMYCOL#${padId(enemyId)}`,
	};
}

/** Enemy collection SK prefix for querying all entries of a child / tenant cleanup. */
export function enemyCollectionPrefix(): string {
	return 'ENEMYCOL#';
}

/**
 * Checklist template: PK=T#<tenantId>#CKTPL, SK=CKTPL#<id>
 * #2362 PR-5 (ADR-0055): family master 化に伴い CHILD#<cId> 配下 → tenant scope に変更。
 */
export function checklistTemplateKey(templateId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(PREFIX.CKTPL, tenantId),
		SK: `CKTPL#${padId(templateId)}`,
	};
}

/** Checklist template SK prefix for querying all templates of a tenant */
export function checklistTemplatePrefix(): string {
	return 'CKTPL#';
}

/**
 * Checklist assignment: PK=T#<tenantId>#CKTPL#<tplId>, SK=ASSIGN#<childId>
 * #2362 PR-5: family checklist ↔ child 配信先 binding。
 *   - PK は対象 template 配下 (template 配下に並ぶ → 配信先一覧の高速 list)
 *   - SK は child パディング ID (child 視点では別途 GSI 不要、tenantPK で query 可能)
 */
export function checklistAssignmentKey(
	templateId: number,
	childId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CKTPL}#${templateId}`, tenantId),
		SK: `ASSIGN#${padId(childId)}`,
	};
}

/** Checklist assignment SK prefix (query assignments of a template) */
export function checklistAssignmentPrefix(): string {
	return 'ASSIGN#';
}

/** Checklist item: PK=CKTPL#<tplId>, SK=ITEM#<sort>#<id> */
export function checklistItemKey(
	templateId: number,
	sortOrder: number,
	itemId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CKTPL}#${templateId}`, tenantId),
		SK: `ITEM#${padId(sortOrder)}#${padId(itemId)}`,
	};
}

/** Checklist item SK prefix for querying all items of a template */
export function checklistItemPrefix(): string {
	return 'ITEM#';
}

/** Checklist log: PK=CHILD#<cId>, SK=CKLOG#<tplId>#<date> */
export function checklistLogKey(
	childId: number,
	templateId: number,
	checkedDate: string,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `CKLOG#${padId(templateId)}#${checkedDate}`,
	};
}

/** Checklist log SK prefix for querying all logs of a child */
export function checklistLogPrefix(): string {
	return 'CKLOG#';
}

/** Checklist log SK prefix for querying logs by template */
export function checklistLogByTemplatePrefix(templateId: number): string {
	return `CKLOG#${padId(templateId)}#`;
}

/** Checklist override: PK=CHILD#<cId>, SK=CKOVER#<date>#<id> */
export function checklistOverrideKey(
	childId: number,
	targetDate: string,
	overrideId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `CKOVER#${targetDate}#${padId(overrideId)}`,
	};
}

/** Checklist override SK prefix for querying all overrides of a child */
export function checklistOverridePrefix(): string {
	return 'CKOVER#';
}

/** Checklist override SK prefix for querying overrides by date */
export function checklistOverrideDatePrefix(targetDate: string): string {
	return `CKOVER#${targetDate}#`;
}

/** Daily mission: PK=CHILD#<cId>, SK=MISSION#<date>#<aId> */
export function dailyMissionKey(
	childId: number,
	missionDate: string,
	activityId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `MISSION#${missionDate}#${padId(activityId)}`,
	};
}

/** Daily mission SK prefix for querying all missions of a child */
export function dailyMissionPrefix(): string {
	return 'MISSION#';
}

/** Daily mission SK prefix for querying missions by date */
export function dailyMissionDatePrefix(missionDate: string): string {
	return `MISSION#${missionDate}#`;
}

/** Activity preference (pin): PK=CHILD#<cId>, SK=ACTPREF#<aId> */
export function activityPrefKey(childId: number, activityId: number, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `ACTPREF#${padId(activityId)}`,
	};
}

/** Activity preference SK prefix */
export function activityPrefPrefix(): string {
	return 'ACTPREF#';
}

/** Activity mastery: PK=CHILD#<cId>, SK=MAST#<actId> */
export function activityMasteryKey(
	childId: number,
	activityId: number,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `MAST#${padId(activityId)}`,
	};
}

/** Activity mastery SK prefix for querying all mastery records of a child */
export function activityMasteryPrefix(): string {
	return 'MAST#';
}

/** Character image: PK=CHILD#<cId>, SK=IMG#<type>#<hash> */
export function characterImageKey(
	childId: number,
	type: string,
	promptHash: string,
	tenantId: string,
): DynamoKey {
	return {
		PK: tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId),
		SK: `IMG#${type}#${promptHash}`,
	};
}

/** Character image SK prefix for querying all images of a child */
export function characterImagePrefix(): string {
	return 'IMG#';
}

/** Character image SK prefix for querying images by type */
export function characterImageTypePrefix(type: string): string {
	return `IMG#${type}#`;
}

/** Market benchmark: PK=BENCH#<age>, SK=CAT#<catId> (global) */
export function marketBenchmarkKey(age: number, categoryId: number): DynamoKey {
	return {
		PK: `${PREFIX.BENCH}#${age}`,
		SK: `CAT#${padId(categoryId)}`,
	};
}

/** Market benchmark SK prefix for querying all benchmarks for an age */
export function marketBenchmarkPrefix(): string {
	return 'CAT#';
}

/** Inquiry: PK=INQUIRY#<inquiryId>, SK=META */
export function inquiryKey(inquiryId: string): DynamoKey {
	return {
		PK: `${PREFIX.INQUIRY}#${inquiryId}`,
		SK: 'META',
	};
}

/**
 * Cancellation reason (#1596 / ADR-0023 §3.8 / I3): PK=CANCEL_REASON, SK=<isoTs>#<id>
 *
 * Global single-partition (low write rate; <100/month想定). createdAt 順にソートされ、
 * 時間範囲クエリに最適。テナント単位のクエリ (削除時のみ) はスキャン+属性フィルタで対応
 * (Pre-PMF, ADR-0010 — GSI 追加は過剰防衛)。
 */
export function cancellationReasonKey(createdAt: string, id: string): DynamoKey {
	return {
		PK: CANCELLATION_REASON_PK,
		SK: `${createdAt}#${id}`,
	};
}

export const CANCELLATION_REASON_PK = 'CANCEL_REASON';

/**
 * Graduation consent (#1603 / ADR-0023 §3.8 / §5 I10): PK=GRADUATION_CONSENT, SK=<isoTs>#<id>
 *
 * Global single-partition (低頻度書込み < 50/月想定 — 卒業はそもそもポジティブで稀)。
 * createdAt 順にソートされ、時間範囲クエリに最適。テナント単位のクエリ (削除時のみ) は
 * Scan + 属性フィルタで対応 (Pre-PMF, ADR-0010 — GSI 追加は過剰防衛)。
 *
 * #1596 cancellationReasonKey と同じパターン (兄弟テーブル)。
 */
export function graduationConsentKey(consentedAt: string, id: string): DynamoKey {
	return {
		PK: GRADUATION_CONSENT_PK,
		SK: `${consentedAt}#${id}`,
	};
}

export const GRADUATION_CONSENT_PK = 'GRADUATION_CONSENT';

/**
 * Stripe Webhook events dedup (#2641 / Phase 5 子 3 / Phase 7 PR-1):
 *   PK = STRIPE_WEBHOOK_EVENT
 *   SK = <event.id>           (例: evt_1ABCxyz)
 *
 * 用途: handleWebhookEvent dispatcher 入口 (Phase 7 PR-4a) で SK 一致を check し、
 * 既存時は handler skip、不在時は handler 実行後に PutItem。
 *
 * Global single-partition (write rate 想定: Pre-PMF で <100/日、PMF 後でも <10k/日)。
 * hot partition 懸念は `cancellation_reasons` (#1596) / `graduation_consent` (#1603) /
 * `analytics_aggregate` (#1693) と同じ既存単一 partition 運用パターン。
 *
 * TTL: 30 日 (Stripe Events API 保持期間と同期、ADR-0049 整合)。
 * `infra/lib/storage-stack.ts:29 timeToLiveAttribute='ttl'` 既設定により AWS が自動削除し、
 * 自社 retention cron 不要 (sqlite 側は別途 `lazy-startup-migrations.ts` から cron 起動)。
 *
 * #1596 cancellationReasonKey と同じパターン (兄弟テーブル)。
 */
export function stripeWebhookEventKey(eventId: string): DynamoKey {
	return {
		PK: STRIPE_WEBHOOK_EVENT_PK,
		SK: eventId,
	};
}

export const STRIPE_WEBHOOK_EVENT_PK = 'STRIPE_WEBHOOK_EVENT';

/** Stripe Webhook events retention 日数 (ADR-0049 整合、Stripe Events API 30 日保持と同期)。 */
export const STRIPE_WEBHOOK_EVENT_TTL_DAYS = 30;

/** ID counter: PK=COUNTER, SK=<entity> */
export function counterKey(entity: string, tenantId: string): DynamoKey {
	return {
		PK: tenantPK(PREFIX.COUNTER, tenantId),
		SK: entity,
	};
}

/**
 * Analytics aggregate (#1693 / #1639 follow-up):
 *   PK = ANALYTICS_AGG#<YYYY-MM-DD>
 *   SK = <kind>           (FUNNEL / CANCELLATION_30D / CANCELLATION_90D)
 *
 * 用途: cron (gq-analytics-aggregator-daily) が前日分の集計を 1 日 1 レコードとして書き込み、
 * /admin/analytics 画面の `+page.server.ts` から query するときに優先取得する (#1693)。
 *
 * Pre-PMF / ADR-0010: GSI 不要 (date 範囲は PK の文字列範囲スキャンで取得可能)。
 * 件数は 1 日あたり数レコード × 365 日 ≒ 数千件で済むため scan 負荷は無視できる。
 *
 * TTL: 365 日 (時系列 trend 確認のため event log 90 日より長く保持)。
 *
 * NOTE: SK 値の constants (`ANALYTICS_AGG_KIND`) と TTL 定数は services/ 層から参照する都合上、
 *  no-direct-db-access テストの制約で `$lib/analytics/providers/dynamo.ts` 側に置いている。
 */
export const ANALYTICS_AGG_PK_PREFIX = 'ANALYTICS_AGG#';

export function analyticsAggregateKey(date: string, kind: string): DynamoKey {
	return {
		PK: `${ANALYTICS_AGG_PK_PREFIX}${date}`,
		SK: kind,
	};
}

/**
 * Challenge aggregate (#1742 — fetchChallengesPerTenant N+1 移行):
 *   PK = CHALLENGE_AGG#<YYYY-MM-DD>
 *   SK = AGGREGATE
 *
 * 用途: cron (gq-challenge-aggregator-daily) が前日分の全テナント
 * `questionnaire_challenges` 設定値を集計し 1 日 1 レコードとして書き込む。
 * `/ops/analytics` プリセット選択分布画面の `getAnalyticsData` 内
 * `fetchChallengesPerTenant` から、集計レコードを優先取得し、無い場合のみ
 * ライブ集計 (settings repo を tenant ごと N+1 で叩く既存実装) で fallback する。
 *
 * Pre-PMF / ADR-0010: GSI 不要 (date 範囲は PK の文字列範囲スキャンで取得可能)。
 * 1 日 1 レコード × 365 日 ≒ 数百件で済むため scan 負荷は無視できる。
 *
 * TTL: 365 日 (時系列 trend 確認のため。ANALYTICS_AGG と同方針)。
 *
 * 関連: PR #1696 (analytics 事前集計 cron) と同じパターン。
 */
export const CHALLENGE_AGG_PK_PREFIX = 'CHALLENGE_AGG#';

/** Challenge aggregate SK 値 (固定。kind 派生は不要 — 1 日 1 レコード) */
export const CHALLENGE_AGG_SK = 'AGGREGATE' as const;

/** Challenge aggregate retention: 365 日 */
export const CHALLENGE_AGG_TTL_DAYS = 365;

export function challengeAggregateKey(date: string): DynamoKey {
	return {
		PK: `${CHALLENGE_AGG_PK_PREFIX}${date}`,
		SK: CHALLENGE_AGG_SK,
	};
}

// ============================================================
// Push subscription / notification log (#1689 / ADR-0023 I6)
// ============================================================
//
// 設計方針:
//   - Tenant 単位の write/read のみがアクセスパターン (低頻度: 1 デバイス/家族 想定)
//   - findByEndpoint は (endpoint, tenantId) を受けるため endpointHash で SK lookup → GetItem 1 回
//   - 追加 GSI は Pre-PMF 規模では不要 (ADR-0010 過剰防衛禁止)
//   - migration script (#1666) は SK が `PUSH_SUB#` 始まりの item を Scan する設計のため、
//     SK = `PUSH_SUB#<endpointHash>` の規約を厳守すること

const PUSH_SUB_HASH_LENGTH = 16; // SHA-256 16 hex chars (64 bit) — 衝突確率 < 10^-9

/**
 * Endpoint の決定的ハッシュを生成する。
 * Service Worker push endpoint URL は長い (200+ chars) ため、SHA-256 先頭 16 桁を SK に使う。
 *
 * 衝突対策: 同一テナント内で 2^32 個の異なる endpoint がない限り衝突しない (生年単位 1 家族 < 10 デバイス想定)。
 * 万一衝突しても tenantId 範囲なので影響範囲は単一家族の 1 通知のみ。
 */
export function pushSubscriptionEndpointHash(endpoint: string): string {
	return createHash('sha256').update(endpoint).digest('hex').slice(0, PUSH_SUB_HASH_LENGTH);
}

/** Push subscription: PK=T#<tenantId>#PUSH_SUB, SK=PUSH_SUB#<endpointHash> */
export function pushSubscriptionKey(tenantId: string, endpointHash: string): DynamoKey {
	return {
		PK: tenantPK(PREFIX.PUSH_SUB, tenantId),
		SK: `${PREFIX.PUSH_SUB}#${endpointHash}`,
	};
}

/** Push subscription PK for tenant Query */
export function pushSubscriptionTenantPK(tenantId: string): string {
	return tenantPK(PREFIX.PUSH_SUB, tenantId);
}

/** Push subscription SK prefix for filtering */
export function pushSubscriptionSKPrefix(): string {
	return `${PREFIX.PUSH_SUB}#`;
}

/** Notification log: PK=T#<tenantId>#NOTIF_LOG, SK=NOTIF#<sentAt>#<id> */
export function notificationLogKey(tenantId: string, sentAt: string, id: number): DynamoKey {
	return {
		PK: tenantPK(PREFIX.NOTIF_LOG, tenantId),
		SK: `NOTIF#${sentAt}#${padId(id)}`,
	};
}

/** Notification log PK for tenant Query */
export function notificationLogTenantPK(tenantId: string): string {
	return tenantPK(PREFIX.NOTIF_LOG, tenantId);
}

/** Notification log SK prefix for date-range queries */
export function notificationLogDatePrefix(date: string): string {
	return `NOTIF#${date}`;
}

// ============================================================
// GSI2 key builders (for category-based activity queries)
// ============================================================

/** GSI2 partition key for activities by category: CAT#<catId> */
export function gsi2CategoryPK(categoryId: number, tenantId: string): string {
	return tenantPK(`CAT#${categoryId}`, tenantId);
}

/** GSI2 sort key for activity ordering: ACT#<sort>#<id> */
export function gsi2ActivitySK(sortOrder: number, activityId: number): string {
	return `ACT#${padId(sortOrder)}#${padId(activityId)}`;
}

// ============================================================
// PK prefix for child partition (used in child entity queries)
// ============================================================

/** Build the CHILD partition key: CHILD#<id> */
export function childPK(childId: number, tenantId: string): string {
	return tenantPK(`${PREFIX.CHILD}#${childId}`, tenantId);
}

// ============================================================
// Entity name constants for counter keys
// ============================================================

export const ENTITY_NAMES = {
	child: 'child',
	category: 'category',
	activity: 'activity',
	childActivity: 'childActivity',
	childChallenge: 'childChallenge',
	activityLog: 'activityLog',
	pointLedger: 'pointLedger',
	status: 'status',
	statusHistory: 'statusHistory',
	evaluation: 'evaluation',
	loginBonus: 'loginBonus',
	achievement: 'achievement',
	childAchievement: 'childAchievement',
	title: 'title',
	childTitle: 'childTitle',
	specialReward: 'specialReward',
	rewardRedemption: 'rewardRedemption',
	parentMessage: 'parentMessage',
	stampCard: 'stampCard',
	dailyBattle: 'dailyBattle',
	enemyCollection: 'enemyCollection',
	checklistTemplate: 'checklistTemplate',
	checklistAssignment: 'checklistAssignment',
	checklistItem: 'checklistItem',
	checklistLog: 'checklistLog',
	checklistOverride: 'checklistOverride',
	dailyMission: 'dailyMission',
	characterImage: 'characterImage',
	marketBenchmark: 'marketBenchmark',
	activityPref: 'activityPref',
	activityMastery: 'activityMastery',
	inquiry: 'inquiry',
	voice: 'voice',
	pushSubscription: 'pushSubscription',
	notificationLog: 'notificationLog',
} as const;

export type EntityName = (typeof ENTITY_NAMES)[keyof typeof ENTITY_NAMES];
