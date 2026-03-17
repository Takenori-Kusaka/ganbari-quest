// src/lib/server/services/combo-service.ts
// コンボボーナスシステム - 同日の複数活動にボーナスを付与

import { getCategoryById } from '$lib/domain/validation/activity';
import { db } from '$lib/server/db';
import { activities, activityLogs, pointLedger } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';

/** Category combo bonus table */
const CATEGORY_COMBO_TABLE = [
	{ minCount: 4, name: 'スーパー', bonus: 10 },
	{ minCount: 3, name: 'トリプル', bonus: 5 },
	{ minCount: 2, name: 'ダブル', bonus: 2 },
] as const;

/** Mini combo: カテゴリ問わず2種類以上の活動で+1P（カテゴリコンボ未発生時のみ） */
const MINI_COMBO_BONUS = 1;

/** Cross-category combo bonus table */
const CROSS_CATEGORY_TABLE = [
	{ minCount: 5, name: 'パーフェクト', bonus: 30 },
	{ minCount: 4, name: 'スーパーヒーロー', bonus: 15 },
	{ minCount: 3, name: 'さんみいったい', bonus: 8 },
	{ minCount: 2, name: 'にとうりゅう', bonus: 3 },
] as const;

export interface CategoryComboEntry {
	categoryId: number;
	uniqueCount: number;
	name: string;
	bonus: number;
}

export interface CrossCategoryCombo {
	categoryCount: number;
	name: string;
	bonus: number;
}

export interface MiniCombo {
	uniqueCount: number;
	bonus: number;
}

export interface ComboHint {
	message: string;
}

export interface ComboResult {
	categoryCombo: CategoryComboEntry[];
	crossCategoryCombo: CrossCategoryCombo | null;
	miniCombo: MiniCombo | null;
	hints: ComboHint[];
	totalNewBonus: number;
}

function calcCategoryComboBonus(uniqueCount: number): { name: string; bonus: number } | null {
	for (const entry of CATEGORY_COMBO_TABLE) {
		if (uniqueCount >= entry.minCount) {
			return { name: entry.name, bonus: entry.bonus };
		}
	}
	return null;
}

function calcCrossCategoryBonus(categoryCount: number): CrossCategoryCombo | null {
	for (const entry of CROSS_CATEGORY_TABLE) {
		if (categoryCount >= entry.minCount) {
			return { categoryCount, name: entry.name, bonus: entry.bonus };
		}
	}
	return null;
}

/**
 * Check today's combo state and grant any new bonus points.
 * Returns the combo result with only the newly granted bonus amount.
 */
export function checkAndGrantCombo(childId: number, date: string): ComboResult {
	// Get today's active logs with category info
	const todayLogs = db
		.select({
			activityId: activityLogs.activityId,
			categoryId: activities.categoryId,
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.recordedDate, date),
				eq(activityLogs.cancelled, 0),
			),
		)
		.all();

	// Group unique activity IDs by categoryId
	const byCat = new Map<number, Set<number>>();
	for (const log of todayLogs) {
		const set = byCat.get(log.categoryId) ?? new Set();
		set.add(log.activityId);
		byCat.set(log.categoryId, set);
	}

	// Calculate category combo bonuses
	let totalDesiredBonus = 0;
	const categoryCombo: CategoryComboEntry[] = [];

	for (const [categoryId, activityIds] of byCat) {
		const result = calcCategoryComboBonus(activityIds.size);
		if (result) {
			categoryCombo.push({
				categoryId,
				uniqueCount: activityIds.size,
				name: result.name,
				bonus: result.bonus,
			});
			totalDesiredBonus += result.bonus;
		}
	}

	// Calculate cross-category combo bonus
	const crossCategoryCombo = calcCrossCategoryBonus(byCat.size);
	if (crossCategoryCombo) {
		totalDesiredBonus += crossCategoryCombo.bonus;
	}

	// Mini combo: カテゴリ問わず2種類以上で+1P（他のコンボが未発生時のみ）
	const totalUniqueActivities = new Set(todayLogs.map((l) => l.activityId)).size;
	let miniCombo: MiniCombo | null = null;
	if (totalUniqueActivities >= 2 && categoryCombo.length === 0 && !crossCategoryCombo) {
		miniCombo = { uniqueCount: totalUniqueActivities, bonus: MINI_COMBO_BONUS };
		totalDesiredBonus += MINI_COMBO_BONUS;
	}

	// Get already-granted combo bonus for today (match by description prefix with date)
	const comboBonusPrefix = `[${date}]`;
	const alreadyGranted = db
		.select({
			total: sql<number>`coalesce(sum(amount), 0)`.as('total'),
		})
		.from(pointLedger)
		.where(
			and(
				eq(pointLedger.childId, childId),
				eq(pointLedger.type, 'combo_bonus'),
				sql`${pointLedger.description} LIKE ${`${comboBonusPrefix}%`}`,
			),
		)
		.get();

	const alreadyAmount = alreadyGranted?.total ?? 0;
	const newBonus = Math.max(0, totalDesiredBonus - alreadyAmount);

	// Grant the difference
	if (newBonus > 0) {
		const parts: string[] = [];
		if (miniCombo) {
			parts.push('ミニコンボ');
		}
		for (const cc of categoryCombo) {
			const catName = getCategoryById(cc.categoryId)?.name ?? String(cc.categoryId);
			parts.push(`${cc.name}コンボ(${catName})`);
		}
		if (crossCategoryCombo) {
			parts.push(crossCategoryCombo.name);
		}
		const description = `${comboBonusPrefix} ${parts.join('・')} +${newBonus}`;

		db.insert(pointLedger)
			.values({
				childId,
				amount: newBonus,
				type: 'combo_bonus',
				description,
			})
			.run();
	}

	// Generate combo hints
	const hints = generateComboHints(byCat, totalUniqueActivities);

	return {
		categoryCombo,
		crossCategoryCombo,
		miniCombo: newBonus > 0 ? miniCombo : null,
		hints,
		totalNewBonus: newBonus,
	};
}

/**
 * コンボ予告ヒントを生成
 */
function generateComboHints(byCat: Map<number, Set<number>>, totalUnique: number): ComboHint[] {
	const hints: ComboHint[] = [];

	// カテゴリコンボのヒント
	for (const [categoryId, activityIds] of byCat) {
		const count = activityIds.size;
		const catName = getCategoryById(categoryId)?.name ?? String(categoryId);
		for (const entry of CATEGORY_COMBO_TABLE) {
			if (count === entry.minCount - 1) {
				hints.push({
					message: `あと1つで${entry.name}コンボ(${catName})！`,
				});
				break;
			}
		}
	}

	// クロスカテゴリのヒント
	const catCount = byCat.size;
	for (const entry of CROSS_CATEGORY_TABLE) {
		if (catCount === entry.minCount - 1) {
			hints.push({
				message: `あと1カテゴリで${entry.name}！`,
			});
			break;
		}
	}

	// ミニコンボのヒント（活動1種のみの場合）
	if (totalUnique === 1 && byCat.size === 1) {
		hints.push({
			message: 'もう1つやるとミニコンボ！',
		});
	}

	return hints;
}
