#!/usr/bin/env npx tsx
// scripts/migrate-sqlite-to-dynamodb.ts
// SQLite → DynamoDB data migration script
//
// Usage:
//   DYNAMODB_TABLE=ganbari-quest npx tsx scripts/migrate-sqlite-to-dynamodb.ts [sqlite-db-path]
//
// Prerequisites:
//   - AWS credentials configured (AWS_PROFILE or env vars)
//   - DynamoDB table already created (via CDK deploy)
//   - @aws-sdk/lib-dynamodb installed

import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import Database from 'better-sqlite3';

const DB_PATH = process.argv[2] ?? './data/ganbari-quest.db';
const TABLE_NAME = process.env.DYNAMODB_TABLE ?? 'ganbari-quest';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const BATCH_SIZE = 25; // DynamoDB BatchWrite limit

// ============================================================
// DynamoDB client
// ============================================================

const config: ConstructorParameters<typeof DynamoDBClient>[0] = { region: REGION };
if (ENDPOINT) {
	config.endpoint = ENDPOINT;
	config.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
}
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient(config), {
	marshallOptions: { removeUndefinedValues: true },
});

// ============================================================
// Key helpers (inline — same as keys.ts)
// ============================================================

function padId(id: number): string {
	return String(id).padStart(8, '0');
}

// ============================================================
// BatchWrite helper
// ============================================================

async function batchPut(items: Record<string, unknown>[]): Promise<number> {
	let written = 0;
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);
		const request = {
			RequestItems: {
				[TABLE_NAME]: batch.map((item) => ({
					PutRequest: { Item: item },
				})),
			},
		};

		let unprocessed = request;
		let retries = 0;
		do {
			const result = await docClient.send(new BatchWriteCommand(unprocessed));
			const remaining = result.UnprocessedItems?.[TABLE_NAME];
			if (remaining && remaining.length > 0) {
				unprocessed = { RequestItems: { [TABLE_NAME]: remaining } };
				retries++;
				// Exponential backoff
				await new Promise((r) => setTimeout(r, 100 * 2 ** retries));
			} else {
				break;
			}
		} while (retries < 5);

		written += batch.length;
	}
	return written;
}

// ============================================================
// Migration functions
// ============================================================

function migrateCategories(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM categories').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CATEGORY#${r.id}`,
		SK: 'MASTER',
		id: r.id,
		code: r.code,
		name: r.name,
		icon: r.icon,
		color: r.color,
	}));
}

function migrateChildren(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM children').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.id}`,
		SK: 'PROFILE',
		id: r.id,
		nickname: r.nickname,
		age: r.age,
		birthDate: r.birth_date,
		theme: r.theme,
		uiMode: r.ui_mode,
		avatarUrl: r.avatar_url,
		activeTitleId: r.active_title_id,
		activeAvatarBg: r.active_avatar_bg,
		activeAvatarFrame: r.active_avatar_frame,
		activeAvatarEffect: r.active_avatar_effect,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	}));
}

function migrateActivities(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM activities').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `ACTIVITY#${r.id}`,
		SK: 'MASTER',
		GSI2PK: `CAT#${r.category_id}`,
		GSI2SK: `ACT#${padId(r.sort_order as number)}#${padId(r.id as number)}`,
		id: r.id,
		name: r.name,
		categoryId: r.category_id,
		icon: r.icon,
		basePoints: r.base_points,
		ageMin: r.age_min,
		ageMax: r.age_max,
		isVisible: r.is_visible,
		dailyLimit: r.daily_limit,
		sortOrder: r.sort_order,
		source: r.source,
		gradeLevel: r.grade_level,
		subcategory: r.subcategory,
		description: r.description,
		nameKana: r.name_kana,
		nameKanji: r.name_kanji,
		createdAt: r.created_at,
	}));
}

function migrateActivityLogs(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM activity_logs').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `LOG#${r.recorded_date}#${padId(r.id as number)}`,
		GSI2PK: `CHILD#${r.child_id}#DATE#${r.recorded_date}`,
		GSI2SK: `ACT#${r.activity_id}#${padId(r.id as number)}`,
		id: r.id,
		childId: r.child_id,
		activityId: r.activity_id,
		points: r.points,
		streakDays: r.streak_days,
		streakBonus: r.streak_bonus,
		recordedDate: r.recorded_date,
		recordedAt: r.recorded_at,
		cancelled: r.cancelled,
	}));
}

function migratePointLedger(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM point_ledger').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `POINT#${r.created_at}#${padId(r.id as number)}`,
		id: r.id,
		childId: r.child_id,
		amount: r.amount,
		type: r.type,
		description: r.description,
		referenceId: r.reference_id,
		createdAt: r.created_at,
	}));
}

function migratePointBalances(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db
		.prepare('SELECT child_id, SUM(amount) as balance FROM point_ledger GROUP BY child_id')
		.all() as { child_id: number; balance: number }[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: 'BALANCE',
		balance: r.balance,
	}));
}

function migrateStatuses(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM statuses').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `STATUS#${padId(r.category_id as number)}`,
		id: r.id,
		childId: r.child_id,
		categoryId: r.category_id,
		value: r.value,
		updatedAt: r.updated_at,
	}));
}

function migrateStatusHistory(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM status_history').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `STATHIST#${padId(r.category_id as number)}#${r.recorded_at}#${padId(r.id as number)}`,
		id: r.id,
		childId: r.child_id,
		categoryId: r.category_id,
		value: r.value,
		changeAmount: r.change_amount,
		changeType: r.change_type,
		recordedAt: r.recorded_at,
	}));
}

function migrateAchievements(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM achievements').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `ACHIEVEMENT#${r.id}`,
		SK: 'MASTER',
		id: r.id,
		code: r.code,
		name: r.name,
		description: r.description,
		icon: r.icon,
		category: r.category,
		conditionType: r.condition_type,
		conditionValue: r.condition_value,
		bonusPoints: r.bonus_points,
		rarity: r.rarity,
		sortOrder: r.sort_order,
		repeatable: r.repeatable,
		milestoneValues: r.milestone_values,
		isMilestone: r.is_milestone,
		createdAt: r.created_at,
	}));
}

function migrateChildAchievements(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM child_achievements').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `ACHV#${padId(r.achievement_id as number)}#${r.milestone_value != null ? String(r.milestone_value) : '0'}`,
		id: r.id,
		childId: r.child_id,
		achievementId: r.achievement_id,
		milestoneValue: r.milestone_value,
		unlockedAt: r.unlocked_at,
	}));
}

function migrateTitles(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM titles').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `TITLE#${r.id}`,
		SK: 'MASTER',
		id: r.id,
		code: r.code,
		name: r.name,
		description: r.description,
		icon: r.icon,
		conditionType: r.condition_type,
		conditionValue: r.condition_value,
		conditionExtra: r.condition_extra,
		rarity: r.rarity,
		sortOrder: r.sort_order,
		createdAt: r.created_at,
	}));
}

function migrateChildTitles(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM child_titles').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `TITLE#${padId(r.title_id as number)}`,
		id: r.id,
		childId: r.child_id,
		titleId: r.title_id,
		unlockedAt: r.unlocked_at,
	}));
}

function migrateLoginBonuses(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM login_bonuses').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `LOGIN#${r.login_date}`,
		id: r.id,
		childId: r.child_id,
		loginDate: r.login_date,
		rank: r.rank,
		basePoints: r.base_points,
		multiplier: r.multiplier,
		totalPoints: r.total_points,
		consecutiveDays: r.consecutive_days,
		createdAt: r.created_at,
	}));
}

function migrateSettings(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM settings').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: 'SETTING',
		SK: r.key,
		key: r.key,
		value: r.value,
		updatedAt: r.updated_at,
	}));
}

function migrateEvaluations(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM evaluations').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `EVAL#${r.week_start}`,
		id: r.id,
		childId: r.child_id,
		weekStart: r.week_start,
		weekEnd: r.week_end,
		scoresJson: r.scores_json,
		bonusPoints: r.bonus_points,
		createdAt: r.created_at,
	}));
}

function migrateSpecialRewards(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM special_rewards').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `REWARD#${r.granted_at}#${padId(r.id as number)}`,
		id: r.id,
		childId: r.child_id,
		grantedBy: r.granted_by,
		title: r.title,
		description: r.description,
		points: r.points,
		icon: r.icon,
		category: r.category,
		grantedAt: r.granted_at,
		shownAt: r.shown_at,
	}));
}

function migrateChecklistTemplates(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM checklist_templates').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `CKTPL#${padId(r.id as number)}`,
		id: r.id,
		childId: r.child_id,
		name: r.name,
		icon: r.icon,
		pointsPerItem: r.points_per_item,
		completionBonus: r.completion_bonus,
		isActive: r.is_active,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	}));
}

function migrateChecklistItems(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM checklist_template_items').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CKTPL#${r.template_id}`,
		SK: `ITEM#${padId(r.sort_order as number)}#${padId(r.id as number)}`,
		id: r.id,
		templateId: r.template_id,
		name: r.name,
		icon: r.icon,
		frequency: r.frequency,
		direction: r.direction,
		sortOrder: r.sort_order,
		createdAt: r.created_at,
	}));
}

function migrateChecklistLogs(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM checklist_logs').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `CKLOG#${padId(r.template_id as number)}#${r.checked_date}`,
		id: r.id,
		childId: r.child_id,
		templateId: r.template_id,
		checkedDate: r.checked_date,
		itemsJson: r.items_json,
		completedAll: r.completed_all,
		pointsAwarded: r.points_awarded,
		createdAt: r.created_at,
	}));
}

function migrateChecklistOverrides(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM checklist_overrides').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `CKOVER#${r.target_date}#${padId(r.id as number)}`,
		id: r.id,
		childId: r.child_id,
		targetDate: r.target_date,
		action: r.action,
		itemName: r.item_name,
		icon: r.icon,
		createdAt: r.created_at,
	}));
}

function migrateDailyMissions(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM daily_missions').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `MISSION#${r.mission_date}#${padId(r.activity_id as number)}`,
		id: r.id,
		childId: r.child_id,
		missionDate: r.mission_date,
		activityId: r.activity_id,
		completed: r.completed,
		completedAt: r.completed_at,
	}));
}

function migrateBirthdayReviews(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM birthday_reviews').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `BDAY#${r.review_year}`,
		id: r.id,
		childId: r.child_id,
		reviewYear: r.review_year,
		ageAtReview: r.age_at_review,
		healthChecks: r.health_checks,
		aspirationText: r.aspiration_text,
		aspirationCategories: r.aspiration_categories,
		basePoints: r.base_points,
		healthPoints: r.health_points,
		aspirationPoints: r.aspiration_points,
		totalPoints: r.total_points,
		createdAt: r.created_at,
	}));
}

function migrateCharacterImages(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM character_images').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `IMG#${r.type}#${r.prompt_hash ?? padId(r.id as number)}`,
		id: r.id,
		childId: r.child_id,
		type: r.type,
		filePath: r.file_path,
		promptHash: r.prompt_hash,
		generatedAt: r.generated_at,
	}));
}

function migrateAvatarItems(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM avatar_items').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `AVITEM#${r.id}`,
		SK: 'MASTER',
		GSI2PK: `AVITEM#CAT#${r.category}`,
		GSI2SK: `${padId(r.sort_order as number)}#${padId(r.id as number)}`,
		id: r.id,
		code: r.code,
		name: r.name,
		description: r.description,
		category: r.category,
		icon: r.icon,
		cssValue: r.css_value,
		price: r.price,
		unlockType: r.unlock_type,
		unlockCondition: r.unlock_condition,
		rarity: r.rarity,
		sortOrder: r.sort_order,
		isActive: r.is_active,
		createdAt: r.created_at,
	}));
}

function migrateChildAvatarItems(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM child_avatar_items').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `CHILD#${r.child_id}`,
		SK: `AVOWN#${padId(r.avatar_item_id as number)}`,
		id: r.id,
		childId: r.child_id,
		avatarItemId: r.avatar_item_id,
		acquiredAt: r.acquired_at,
	}));
}

function migrateMarketBenchmarks(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const rows = db.prepare('SELECT * FROM market_benchmarks').all() as Record<string, unknown>[];
	return rows.map((r) => ({
		PK: `BENCH#${r.age}`,
		SK: `CAT#${padId(r.category_id as number)}`,
		id: r.id,
		age: r.age,
		categoryId: r.category_id,
		mean: r.mean,
		stdDev: r.std_dev,
		source: r.source,
		updatedAt: r.updated_at,
	}));
}

// ============================================================
// Counter initialization
// ============================================================

function buildCounterItems(db: InstanceType<typeof Database>): Record<string, unknown>[] {
	const counters: Record<string, unknown>[] = [];
	const tables: [string, string][] = [
		['child', 'children'],
		['category', 'categories'],
		['activity', 'activities'],
		['activityLog', 'activity_logs'],
		['pointLedger', 'point_ledger'],
		['status', 'statuses'],
		['statusHistory', 'status_history'],
		['evaluation', 'evaluations'],
		['loginBonus', 'login_bonuses'],
		['achievement', 'achievements'],
		['childAchievement', 'child_achievements'],
		['title', 'titles'],
		['childTitle', 'child_titles'],
		['specialReward', 'special_rewards'],
		['checklistTemplate', 'checklist_templates'],
		['checklistItem', 'checklist_template_items'],
		['checklistLog', 'checklist_logs'],
		['checklistOverride', 'checklist_overrides'],
		['dailyMission', 'daily_missions'],
		['birthdayReview', 'birthday_reviews'],
		['characterImage', 'character_images'],
		['avatarItem', 'avatar_items'],
		['childAvatarItem', 'child_avatar_items'],
		['marketBenchmark', 'market_benchmarks'],
	];

	for (const [entity, table] of tables) {
		try {
			const row = db.prepare(`SELECT MAX(id) as maxId FROM ${table}`).get() as { maxId: number | null };
			const maxId = row?.maxId ?? 0;
			counters.push({
				PK: 'COUNTER',
				SK: entity,
				counter: maxId,
			});
		} catch {
			// Table may not exist
			counters.push({
				PK: 'COUNTER',
				SK: entity,
				counter: 0,
			});
		}
	}

	return counters;
}

// ============================================================
// Main
// ============================================================

async function main() {
	console.log(`[MIGRATE] Opening SQLite: ${DB_PATH}`);
	console.log(`[MIGRATE] Target DynamoDB table: ${TABLE_NAME}`);
	if (ENDPOINT) console.log(`[MIGRATE] Using endpoint: ${ENDPOINT}`);

	const db = new Database(DB_PATH, { readonly: true });
	db.pragma('foreign_keys = OFF');

	const migrations: [string, () => Record<string, unknown>[]][] = [
		['categories', () => migrateCategories(db)],
		['children', () => migrateChildren(db)],
		['activities', () => migrateActivities(db)],
		['activity_logs', () => migrateActivityLogs(db)],
		['point_ledger', () => migratePointLedger(db)],
		['point_balances', () => migratePointBalances(db)],
		['statuses', () => migrateStatuses(db)],
		['status_history', () => migrateStatusHistory(db)],
		['achievements', () => migrateAchievements(db)],
		['child_achievements', () => migrateChildAchievements(db)],
		['titles', () => migrateTitles(db)],
		['child_titles', () => migrateChildTitles(db)],
		['login_bonuses', () => migrateLoginBonuses(db)],
		['settings', () => migrateSettings(db)],
		['evaluations', () => migrateEvaluations(db)],
		['special_rewards', () => migrateSpecialRewards(db)],
		['checklist_templates', () => migrateChecklistTemplates(db)],
		['checklist_items', () => migrateChecklistItems(db)],
		['checklist_logs', () => migrateChecklistLogs(db)],
		['checklist_overrides', () => migrateChecklistOverrides(db)],
		['daily_missions', () => migrateDailyMissions(db)],
		['birthday_reviews', () => migrateBirthdayReviews(db)],
		['character_images', () => migrateCharacterImages(db)],
		['avatar_items', () => migrateAvatarItems(db)],
		['child_avatar_items', () => migrateChildAvatarItems(db)],
		['market_benchmarks', () => migrateMarketBenchmarks(db)],
		['counters', () => buildCounterItems(db)],
	];

	let totalWritten = 0;

	for (const [name, migrateFn] of migrations) {
		try {
			const items = migrateFn();
			if (items.length === 0) {
				console.log(`  [${name}] 0 rows (empty table)`);
				continue;
			}
			const written = await batchPut(items);
			console.log(`  [${name}] ${written} items written`);
			totalWritten += written;
		} catch (e) {
			console.error(`  [${name}] ERROR: ${e instanceof Error ? e.message : e}`);
		}
	}

	db.close();
	console.log(`\n[MIGRATE] Complete! Total: ${totalWritten} items written to DynamoDB.`);
}

main().catch((e) => {
	console.error('[MIGRATE] Fatal error:', e);
	process.exit(1);
});
