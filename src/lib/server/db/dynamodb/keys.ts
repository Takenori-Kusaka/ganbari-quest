// src/lib/server/db/dynamodb/keys.ts
// PK/SK generation helpers for single-table design
// All entity keys are defined here for type-safe, consistent key construction.

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
	CAREER: 'CAREER',
	CARPLAN: 'CARPLAN',
	CKTPL: 'CKTPL',
	AVITEM: 'AVITEM',
	BENCH: 'BENCH',
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
// Entity key builders
// ============================================================

/** Child profile: PK=CHILD#<id>, SK=PROFILE */
export function childKey(childId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: 'PROFILE',
	};
}

/** Category master: PK=CATEGORY#<id>, SK=MASTER */
export function categoryKey(categoryId: number): DynamoKey {
	return {
		PK: `${PREFIX.CATEGORY}#${categoryId}`,
		SK: 'MASTER',
	};
}

/** Activity master: PK=ACTIVITY#<id>, SK=MASTER */
export function activityKey(activityId: number): DynamoKey {
	return {
		PK: `${PREFIX.ACTIVITY}#${activityId}`,
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
): DynamoKeyWithGSI2 {
	return {
		...activityKey(activityId),
		GSI2PK: `CAT#${categoryId}`,
		GSI2SK: `ACT#${padId(sortOrder)}#${padId(activityId)}`,
	};
}

/** Activity log: PK=CHILD#<cId>, SK=LOG#<date>#<id> */
export function activityLogKey(childId: number, recordedDate: string, logId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
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
export function pointLedgerKey(childId: number, createdAt: string, ledgerId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: `POINT#${createdAt}#${padId(ledgerId)}`,
	};
}

/** Point ledger SK prefix for querying all points of a child */
export function pointLedgerPrefix(): string {
	return 'POINT#';
}

/** Point balance (aggregated): PK=CHILD#<cId>, SK=BALANCE */
export function pointBalanceKey(childId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: 'BALANCE',
	};
}

/** Status: PK=CHILD#<cId>, SK=STATUS#<catId> */
export function statusKey(childId: number, categoryId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
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
): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
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
	milestoneValue?: number | null,
): DynamoKey {
	const ms = milestoneValue != null ? String(milestoneValue) : '0';
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
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
export function childTitleKey(childId: number, titleId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: `TITLE#${padId(titleId)}`,
	};
}

/** Child title SK prefix for querying all titles of a child */
export function childTitlePrefix(): string {
	return 'TITLE#';
}

/** Login bonus: PK=CHILD#<cId>, SK=LOGIN#<date> */
export function loginBonusKey(childId: number, loginDate: string): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: `LOGIN#${loginDate}`,
	};
}

/** Login bonus SK prefix for querying all bonuses of a child */
export function loginBonusPrefix(): string {
	return 'LOGIN#';
}

/** Setting: PK=SETTING, SK=<key> */
export function settingKey(key: string): DynamoKey {
	return {
		PK: PREFIX.SETTING,
		SK: key,
	};
}

/** Evaluation: PK=CHILD#<cId>, SK=EVAL#<weekStart> */
export function evaluationKey(childId: number, weekStart: string): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: `EVAL#${weekStart}`,
	};
}

/** Evaluation SK prefix for querying all evaluations of a child */
export function evaluationPrefix(): string {
	return 'EVAL#';
}

/** Special reward: PK=CHILD#<cId>, SK=REWARD#<ts>#<id> */
export function specialRewardKey(childId: number, grantedAt: string, rewardId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: `REWARD#${grantedAt}#${padId(rewardId)}`,
	};
}

/** Special reward SK prefix for querying all rewards of a child */
export function specialRewardPrefix(): string {
	return 'REWARD#';
}

/** Checklist template: PK=CHILD#<cId>, SK=CKTPL#<id> */
export function checklistTemplateKey(childId: number, templateId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: `CKTPL#${padId(templateId)}`,
	};
}

/** Checklist template SK prefix for querying all templates of a child */
export function checklistTemplatePrefix(): string {
	return 'CKTPL#';
}

/** Checklist item: PK=CKTPL#<tplId>, SK=ITEM#<sort>#<id> */
export function checklistItemKey(templateId: number, sortOrder: number, itemId: number): DynamoKey {
	return {
		PK: `${PREFIX.CKTPL}#${templateId}`,
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
): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
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
): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
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
): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
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

/** Birthday review: PK=CHILD#<cId>, SK=BDAY#<year> */
export function birthdayReviewKey(childId: number, reviewYear: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: `BDAY#${reviewYear}`,
	};
}

/** Birthday review SK prefix for querying all reviews of a child */
export function birthdayReviewPrefix(): string {
	return 'BDAY#';
}

/** Character image: PK=CHILD#<cId>, SK=IMG#<type>#<hash> */
export function characterImageKey(childId: number, type: string, promptHash: string): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
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

/** Career field master: PK=CAREER#<id>, SK=MASTER */
export function careerFieldKey(careerFieldId: number): DynamoKey {
	return {
		PK: `${PREFIX.CAREER}#${careerFieldId}`,
		SK: 'MASTER',
	};
}

/** Career plan: PK=CHILD#<cId>, SK=CARPLAN#<id> */
export function careerPlanKey(childId: number, planId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: `CARPLAN#${padId(planId)}`,
	};
}

/** Career plan SK prefix for querying all plans of a child */
export function careerPlanPrefix(): string {
	return 'CARPLAN#';
}

/** Career plan history: PK=CARPLAN#<planId>, SK=HIST#<ts>#<id> */
export function careerPlanHistoryKey(
	planId: number,
	createdAt: string,
	historyId: number,
): DynamoKey {
	return {
		PK: `${PREFIX.CARPLAN}#${planId}`,
		SK: `HIST#${createdAt}#${padId(historyId)}`,
	};
}

/** Career plan history SK prefix for querying all history of a plan */
export function careerPlanHistoryPrefix(): string {
	return 'HIST#';
}

/** Avatar item master: PK=AVITEM#<id>, SK=MASTER */
export function avatarItemKey(itemId: number): DynamoKey {
	return {
		PK: `${PREFIX.AVITEM}#${itemId}`,
		SK: 'MASTER',
	};
}

/** Child avatar item: PK=CHILD#<cId>, SK=AVOWN#<itemId> */
export function childAvatarItemKey(childId: number, itemId: number): DynamoKey {
	return {
		PK: `${PREFIX.CHILD}#${childId}`,
		SK: `AVOWN#${padId(itemId)}`,
	};
}

/** Child avatar item SK prefix for querying all owned items of a child */
export function childAvatarItemPrefix(): string {
	return 'AVOWN#';
}

/** Market benchmark: PK=BENCH#<age>, SK=CAT#<catId> */
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

/** ID counter: PK=COUNTER, SK=<entity> */
export function counterKey(entity: string): DynamoKey {
	return {
		PK: PREFIX.COUNTER,
		SK: entity,
	};
}

// ============================================================
// GSI2 key builders (for category-based activity queries)
// ============================================================

/** GSI2 partition key for activities by category: CAT#<catId> */
export function gsi2CategoryPK(categoryId: number): string {
	return `CAT#${categoryId}`;
}

/** GSI2 sort key for activity ordering: ACT#<sort>#<id> */
export function gsi2ActivitySK(sortOrder: number, activityId: number): string {
	return `ACT#${padId(sortOrder)}#${padId(activityId)}`;
}

// ============================================================
// PK prefix for child partition (used in child entity queries)
// ============================================================

/** Build the CHILD partition key: CHILD#<id> */
export function childPK(childId: number): string {
	return `${PREFIX.CHILD}#${childId}`;
}

// ============================================================
// Entity name constants for counter keys
// ============================================================

export const ENTITY_NAMES = {
	child: 'child',
	category: 'category',
	activity: 'activity',
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
	checklistTemplate: 'checklistTemplate',
	checklistItem: 'checklistItem',
	checklistLog: 'checklistLog',
	checklistOverride: 'checklistOverride',
	dailyMission: 'dailyMission',
	birthdayReview: 'birthdayReview',
	characterImage: 'characterImage',
	careerField: 'careerField',
	careerPlan: 'careerPlan',
	careerPlanHistory: 'careerPlanHistory',
	avatarItem: 'avatarItem',
	childAvatarItem: 'childAvatarItem',
	marketBenchmark: 'marketBenchmark',
} as const;

export type EntityName = (typeof ENTITY_NAMES)[keyof typeof ENTITY_NAMES];
