// src/lib/server/services/export-service.ts
// 家族データエクスポートサービス（Phase 1: エクスポートのみ）

import {
	EXPORT_FORMAT,
	EXPORT_VERSION,
	type ExportAchievement,
	type ExportActivity,
	type ExportActivityLog,
	type ExportAvatarItem,
	type ExportBirthdayReview,
	type ExportCareerField,
	type ExportCareerPlan,
	type ExportCategory,
	type ExportChecklistTemplate,
	type ExportChild,
	type ExportChildAchievement,
	type ExportChildAvatarItem,
	type ExportChildTitle,
	type ExportData,
	type ExportEvaluation,
	type ExportLoginBonus,
	type ExportOptions,
	type ExportPointLedger,
	type ExportSpecialReward,
	type ExportStatus,
	type ExportStatusHistory,
	type ExportTitle,
	type ExportTransactionData,
} from '$lib/domain/export-format';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { findAllAchievements, findUnlockedAchievements } from '$lib/server/db/achievement-repo';
import { findActivities, findActivityLogs } from '$lib/server/db/activity-repo';
import { findAllAvatarItems, findOwnedItems } from '$lib/server/db/avatar-repo';
import { findBirthdayReviews } from '$lib/server/db/birthday-repo';
import { findAllCareerFields, findCareerPlansByChildId } from '$lib/server/db/career-repo';
import { findTemplateItems, findTemplatesByChild } from '$lib/server/db/checklist-repo';
import { findAllChildren } from '$lib/server/db/child-repo';
import { findEvaluationsByChild } from '$lib/server/db/evaluation-repo';
import { findRecentBonuses } from '$lib/server/db/login-bonus-repo';
import { findPointHistory } from '$lib/server/db/point-repo';
import { findSpecialRewards } from '$lib/server/db/special-reward-repo';
import { findRecentStatusHistory, findStatuses } from '$lib/server/db/status-repo';
import { findAllTitles, findUnlockedTitles } from '$lib/server/db/title-repo';
import { logger } from '$lib/server/logger';

// カテゴリID → コード マッピング（5件固定）
const CATEGORY_ID_TO_CODE: Record<number, string> = {
	1: CATEGORY_CODES[0], // undou
	2: CATEGORY_CODES[1], // benkyou
	3: CATEGORY_CODES[2], // seikatsu
	4: CATEGORY_CODES[3], // kouryuu
	5: CATEGORY_CODES[4], // souzou
};

// カテゴリID → 情報マッピング
const CATEGORY_INFO: ExportCategory[] = [
	{ id: 1, code: 'undou', name: 'うんどう', icon: '🏃', color: '#FF6B6B' },
	{ id: 2, code: 'benkyou', name: 'べんきょう', icon: '📚', color: '#4ECDC4' },
	{ id: 3, code: 'seikatsu', name: 'せいかつ', icon: '🏠', color: '#45B7D1' },
	{ id: 4, code: 'kouryuu', name: 'こうりゅう', icon: '🤝', color: '#96CEB4' },
	{ id: 5, code: 'souzou', name: 'そうぞう', icon: '🎨', color: '#DDA0DD' },
];

const MAX_EXPORT_ROWS = 999999;

function getCategoryCode(categoryId: number): string {
	return CATEGORY_ID_TO_CODE[categoryId] ?? 'unknown';
}

/**
 * SHA-256 チェックサムを計算
 */
async function computeChecksum(data: string): Promise<string> {
	const encoder = new TextEncoder();
	const buffer = encoder.encode(data);
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return `sha256:${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 家族データをエクスポート
 */
export async function exportFamilyData(options: ExportOptions): Promise<ExportData> {
	const { tenantId, childIds } = options;

	logger.info('[export] エクスポート開始', { context: { tenantId, childIds } });

	// 子供一覧の取得
	let allChildren = await findAllChildren(tenantId);
	if (childIds && childIds.length > 0) {
		const idSet = new Set(childIds);
		allChildren = allChildren.filter((c) => idSet.has(c.id));
	}

	if (allChildren.length === 0) {
		logger.warn('[export] エクスポート対象の子供がいません');
	}

	// マスタデータの取得（並列）
	const [activitiesRaw, titlesRaw, achievementsRaw, avatarItemsRaw, careerFieldsRaw] =
		await Promise.all([
			findActivities(tenantId),
			findAllTitles(tenantId),
			findAllAchievements(tenantId),
			findAllAvatarItems(tenantId),
			findAllCareerFields(tenantId),
		]);

	// 称号 ID → コード
	const titleMap = new Map(titlesRaw.map((t) => [t.id, t]));
	// 実績 ID → コード
	const achievementMap = new Map(achievementsRaw.map((a) => [a.id, a]));
	// アバターアイテム ID → コード
	const avatarItemMap = new Map(avatarItemsRaw.map((a) => [a.id, a]));
	// キャリア分野 ID → 名前
	const careerFieldMap = new Map(careerFieldsRaw.map((f) => [f.id, f]));

	// マスタデータの変換
	const masterActivities: ExportActivity[] = activitiesRaw.map((a) => ({
		name: a.name,
		categoryCode: getCategoryCode(a.categoryId),
		icon: a.icon,
		basePoints: a.basePoints,
		gradeLevel: a.gradeLevel,
		nameKana: a.nameKana,
		nameKanji: a.nameKanji,
		triggerHint: a.triggerHint,
	}));

	const masterTitles: ExportTitle[] = titlesRaw.map((t) => ({
		code: t.code,
		name: t.name,
		icon: t.icon,
		rarity: t.rarity,
	}));

	const masterAchievements: ExportAchievement[] = achievementsRaw.map((a) => ({
		code: a.code,
		name: a.name,
		icon: a.icon,
		rarity: a.rarity,
	}));

	const masterAvatarItems: ExportAvatarItem[] = avatarItemsRaw.map((a) => ({
		code: a.code,
		name: a.name,
		category: a.category,
		icon: a.icon,
		rarity: a.rarity,
	}));

	const masterCareerFields: ExportCareerField[] = careerFieldsRaw.map((f) => ({
		name: f.name,
		icon: f.icon,
	}));

	// 子供データの変換
	const exportChildren: ExportChild[] = allChildren.map((child, index) => ({
		exportId: `child-${index + 1}`,
		nickname: child.nickname,
		age: child.age,
		birthDate: child.birthDate,
		theme: child.theme,
		uiMode: child.uiMode,
		avatarUrl: child.avatarUrl,
		activeTitle: child.activeTitleId ? (titleMap.get(child.activeTitleId)?.name ?? null) : null,
		activeAvatarBg: child.activeAvatarBg
			? (avatarItemMap.get(child.activeAvatarBg)?.code ?? null)
			: null,
		activeAvatarFrame: child.activeAvatarFrame
			? (avatarItemMap.get(child.activeAvatarFrame)?.code ?? null)
			: null,
		activeAvatarEffect: child.activeAvatarEffect
			? (avatarItemMap.get(child.activeAvatarEffect)?.code ?? null)
			: null,
		createdAt: child.createdAt,
	}));

	// childId → exportId マッピング
	const childExportIdMap = new Map(
		allChildren.map((child, index) => [child.id, `child-${index + 1}`]),
	);

	// 各子供のトランザクションデータを収集
	const transactionData = await collectTransactionData(
		allChildren.map((c) => c.id),
		childExportIdMap,
		titleMap,
		achievementMap,
		avatarItemMap,
		careerFieldMap,
		tenantId,
	);

	// チェックサム計算用の仮データ構築
	const exportDataWithoutChecksum = {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		checksum: '',
		master: {
			categories: CATEGORY_INFO,
			activities: masterActivities,
			titles: masterTitles,
			achievements: masterAchievements,
			avatarItems: masterAvatarItems,
			careerFields: masterCareerFields,
		},
		family: {
			children: exportChildren,
		},
		data: transactionData,
	};

	// チェックサム計算（checksum フィールドを除いたJSON文字列のハッシュ）
	const checksumPayload = JSON.stringify({
		...exportDataWithoutChecksum,
		checksum: undefined,
	});
	const checksum = await computeChecksum(checksumPayload);

	const exportData: ExportData = {
		...exportDataWithoutChecksum,
		checksum,
	};

	const totalRecords =
		transactionData.activityLogs.length +
		transactionData.pointLedger.length +
		transactionData.statuses.length +
		transactionData.childAchievements.length;

	logger.info('[export] エクスポート完了', {
		context: {
			children: exportChildren.length,
			activities: masterActivities.length,
			totalRecords,
		},
	});

	return exportData;
}

async function collectTransactionData(
	childIds: number[],
	childExportIdMap: Map<number, string>,
	titleMap: Map<number, { code: string }>,
	achievementMap: Map<number, { code: string }>,
	avatarItemMap: Map<number, { code: string }>,
	careerFieldMap: Map<number, { name: string }>,
	tenantId: string,
): Promise<ExportTransactionData> {
	const allActivityLogs: ExportActivityLog[] = [];
	const allPointLedger: ExportPointLedger[] = [];
	const allStatuses: ExportStatus[] = [];
	const allStatusHistory: ExportStatusHistory[] = [];
	const allChildAchievements: ExportChildAchievement[] = [];
	const allChildTitles: ExportChildTitle[] = [];
	const allLoginBonuses: ExportLoginBonus[] = [];
	const allEvaluations: ExportEvaluation[] = [];
	const allSpecialRewards: ExportSpecialReward[] = [];
	const allChecklistTemplates: ExportChecklistTemplate[] = [];
	const allChildAvatarItems: ExportChildAvatarItem[] = [];
	const allCareerPlans: ExportCareerPlan[] = [];
	const allBirthdayReviews: ExportBirthdayReview[] = [];

	for (const childId of childIds) {
		const childRef = childExportIdMap.get(childId) ?? `child-${childId}`;

		// 各データを並列取得
		const [
			activityLogs,
			pointHistory,
			statuses,
			unlockedAchievements,
			unlockedTitles,
			loginBonuses,
			evaluations,
			specialRewards,
			checklistTemplates,
			ownedAvatarItems,
			careerPlans,
			birthdayReviews,
		] = await Promise.all([
			findActivityLogs(childId, tenantId),
			findPointHistory(childId, { limit: MAX_EXPORT_ROWS, offset: 0 }, tenantId),
			findStatuses(childId, tenantId),
			findUnlockedAchievements(childId, tenantId),
			findUnlockedTitles(childId, tenantId),
			findRecentBonuses(childId, tenantId, MAX_EXPORT_ROWS),
			findEvaluationsByChild(childId, MAX_EXPORT_ROWS, tenantId),
			findSpecialRewards(childId, tenantId),
			findTemplatesByChild(childId, tenantId, true),
			findOwnedItems(childId, tenantId),
			findCareerPlansByChildId(childId, tenantId),
			findBirthdayReviews(childId, tenantId),
		]);

		// ステータス履歴は全カテゴリ分を取得
		const statusHistoryPromises = [1, 2, 3, 4, 5].map((catId) =>
			findRecentStatusHistory(childId, catId, tenantId, MAX_EXPORT_ROWS),
		);
		const statusHistoryResults = await Promise.all(statusHistoryPromises);

		// Activity logs
		for (const log of activityLogs) {
			allActivityLogs.push({
				childRef,
				activityName: log.activityName,
				activityCategory: getCategoryCode(log.categoryId),
				points: log.points,
				streakDays: log.streakDays,
				streakBonus: log.streakBonus,
				recordedDate: log.recordedAt.split('T')[0] ?? log.recordedAt,
				recordedAt: log.recordedAt,
				cancelled: false,
			});
		}

		// Point ledger
		for (const entry of pointHistory) {
			allPointLedger.push({
				childRef,
				amount: entry.amount,
				type: entry.type,
				description: entry.description,
				createdAt: entry.createdAt,
			});
		}

		// Statuses
		for (const status of statuses) {
			allStatuses.push({
				childRef,
				categoryCode: getCategoryCode(status.categoryId),
				value: status.value,
				updatedAt: status.updatedAt,
			});
		}

		// Status history
		for (const entries of statusHistoryResults) {
			for (const entry of entries) {
				allStatusHistory.push({
					childRef,
					categoryCode: getCategoryCode(entry.categoryId),
					value: entry.value,
					changeAmount: entry.changeAmount,
					changeType: entry.changeType,
					recordedAt: entry.recordedAt,
				});
			}
		}

		// Achievements
		for (const ca of unlockedAchievements) {
			const achievement = achievementMap.get(ca.achievementId);
			if (achievement) {
				allChildAchievements.push({
					childRef,
					achievementCode: achievement.code,
					milestoneValue: ca.milestoneValue,
					unlockedAt: ca.unlockedAt,
				});
			}
		}

		// Titles
		for (const ct of unlockedTitles) {
			const title = titleMap.get(ct.titleId);
			if (title) {
				allChildTitles.push({
					childRef,
					titleCode: title.code,
					unlockedAt: ct.unlockedAt,
				});
			}
		}

		// Login bonuses
		for (const lb of loginBonuses) {
			allLoginBonuses.push({
				childRef,
				loginDate: lb.loginDate,
				rank: lb.rank,
				basePoints: lb.basePoints,
				multiplier: lb.multiplier,
				totalPoints: lb.totalPoints,
				consecutiveDays: lb.consecutiveDays,
				createdAt: lb.createdAt,
			});
		}

		// Evaluations
		for (const ev of evaluations) {
			allEvaluations.push({
				childRef,
				weekStart: ev.weekStart,
				weekEnd: ev.weekEnd,
				scoresJson: ev.scoresJson,
				bonusPoints: ev.bonusPoints,
				createdAt: ev.createdAt,
			});
		}

		// Special rewards
		for (const sr of specialRewards) {
			allSpecialRewards.push({
				childRef,
				title: sr.title,
				description: sr.description,
				points: sr.points,
				icon: sr.icon,
				category: sr.category,
				grantedAt: sr.grantedAt,
			});
		}

		// Checklist templates with items
		for (const tpl of checklistTemplates) {
			const items = await findTemplateItems(tpl.id, tenantId);
			allChecklistTemplates.push({
				childRef,
				name: tpl.name,
				icon: tpl.icon,
				pointsPerItem: tpl.pointsPerItem,
				completionBonus: tpl.completionBonus,
				isActive: tpl.isActive === 1,
				items: items.map((item) => ({
					name: item.name,
					icon: item.icon,
					frequency: item.frequency,
					direction: item.direction,
					sortOrder: item.sortOrder,
				})),
			});
		}

		// Owned avatar items
		for (const oi of ownedAvatarItems) {
			const item = avatarItemMap.get(oi.avatarItemId);
			if (item) {
				allChildAvatarItems.push({
					childRef,
					itemCode: item.code,
					acquiredAt: oi.acquiredAt,
				});
			}
		}

		// Career plans
		for (const cp of careerPlans) {
			const field = cp.careerFieldId ? careerFieldMap.get(cp.careerFieldId) : null;
			allCareerPlans.push({
				childRef,
				careerFieldName: field?.name ?? null,
				dreamText: cp.dreamText,
				mandalaChart: cp.mandalaChart,
				timeline3y: cp.timeline3y,
				timeline5y: cp.timeline5y,
				timeline10y: cp.timeline10y,
				targetStatuses: cp.targetStatuses,
				version: cp.version,
				isActive: cp.isActive === 1,
				createdAt: cp.createdAt,
				updatedAt: cp.updatedAt,
			});
		}

		// Birthday reviews
		for (const br of birthdayReviews) {
			allBirthdayReviews.push({
				childRef,
				reviewYear: br.reviewYear,
				ageAtReview: br.ageAtReview,
				healthChecks: br.healthChecks,
				aspirationText: br.aspirationText,
				aspirationCategories: br.aspirationCategories,
				basePoints: br.basePoints,
				healthPoints: br.healthPoints,
				aspirationPoints: br.aspirationPoints,
				totalPoints: br.totalPoints,
				createdAt: br.createdAt,
			});
		}
	}

	return {
		activityLogs: allActivityLogs,
		pointLedger: allPointLedger,
		statuses: allStatuses,
		statusHistory: allStatusHistory,
		childAchievements: allChildAchievements,
		childTitles: allChildTitles,
		loginBonuses: allLoginBonuses,
		evaluations: allEvaluations,
		specialRewards: allSpecialRewards,
		checklistTemplates: allChecklistTemplates,
		checklistLogs: [], // Phase 2: バルク取得メソッド追加後に対応
		childAvatarItems: allChildAvatarItems,
		careerPlans: allCareerPlans,
		birthdayReviews: allBirthdayReviews,
		dailyMissions: [], // Phase 2: エフェメラルデータ対応後に対応
	};
}
