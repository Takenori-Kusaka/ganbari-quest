import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
// src/lib/server/services/combo-service.ts
// コンボボーナスシステム - 同日の複数活動にボーナスを付与

import { getCategoryById } from '$lib/domain/validation/activity';
import {
	findTodayLogsWithCategory,
	getComboPointsGranted,
	insertPointLedger,
} from '$lib/server/db/activity-repo';

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
	categoryId: CategoryId;
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
 * Check today's combo state and reconcile the granted bonus with the desired bonus.
 *
 * #4686: 付与は「あるべき額 − 当日付与済み合計」の**差分**で行う。記録で差分が正なら加算、
 * とりけしで差分が負なら同じ経路で負方向に計上する (付与した経路と同じ経路で取り消す、#3787 と同 class)。
 * 戻り値の `totalNewBonus` は今回の純増 (負値 = 巻き戻し)。結果ダイアログは tier 満額ではなく
 * この純増を表示する (表示額 = 台帳増分)。
 */
export async function reconcileComboBonus(
	childId: ChildId,
	date: string,
	tenantId: string,
): Promise<ComboResult> {
	// Get today's active logs with category info
	const todayLogs = await findTodayLogsWithCategory(childId, date, tenantId);

	// Group unique activity IDs by categoryId
	const byCat = new Map<CategoryId, Set<ActivityId>>();
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
	const alreadyAmount = await getComboPointsGranted(childId, comboBonusPrefix, tenantId);
	// 差分 (正 = 新規付与 / 負 = とりけしによる巻き戻し / 0 = 変化なし)
	const newBonus = totalDesiredBonus - alreadyAmount;

	if (newBonus !== 0) {
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
		const description =
			newBonus > 0
				? `${comboBonusPrefix} ${parts.join('・')} +${newBonus}`
				: `${comboBonusPrefix} コンボとりけし${parts.length > 0 ? `（${parts.join('・')}）` : ''} ${newBonus}`;

		await insertPointLedger(
			{
				childId,
				amount: newBonus,
				type: 'combo_bonus',
				description,
			},
			tenantId,
		);
	}

	// Generate combo hints
	const hints = generateComboHints(byCat, totalUniqueActivities);

	return {
		categoryCombo,
		crossCategoryCombo,
		miniCombo,
		hints,
		totalNewBonus: newBonus,
	};
}

/** 記録経路の既存呼び出し名 (reconcileComboBonus と同一。差分付与 + 結果返却)。 */
export const checkAndGrantCombo = reconcileComboBonus;

/**
 * コンボ予告ヒントを生成
 */
function generateComboHints(
	byCat: Map<CategoryId, Set<ActivityId>>,
	totalUnique: number,
): ComboHint[] {
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
