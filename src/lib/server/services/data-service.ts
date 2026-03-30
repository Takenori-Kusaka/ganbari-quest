// src/lib/server/services/data-service.ts
// テナントデータクリア・サマリーサービス (#0205)

import { db } from '$lib/server/db/client';
import {
	activityLogs,
	activityMastery,
	birthdayReviews,
	careerPlanHistory,
	careerPlans,
	characterImages,
	checklistLogs,
	checklistOverrides,
	checklistTemplateItems,
	checklistTemplates,
	childAchievements,
	childActivityPreferences,
	childAvatarItems,
	childCustomVoices,
	childSkillNodes,
	childTitles,
	children,
	dailyMissions,
	evaluations,
	levelTitles,
	loginBonuses,
	pointLedger,
	skillPoints,
	specialRewards,
	stampCards,
	stampEntries,
	statusHistory,
	statuses,
} from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { sql } from 'drizzle-orm';
import { deleteChildFiles } from './child-service';

// ============================================================
// Types
// ============================================================

export interface DataSummary {
	children: number;
	activityLogs: number;
	pointLedger: number;
	statuses: number;
	achievements: number;
	titles: number;
	loginBonuses: number;
	checklistTemplates: number;
	careerPlans: number;
	birthdayReviews: number;
	avatarItems: number;
	voices: number;
}

export interface ClearResult {
	deleted: {
		children: number;
		activityLogs: number;
		pointLedger: number;
		statuses: number;
		statusHistory: number;
		achievements: number;
		titles: number;
		loginBonuses: number;
		checklistTemplates: number;
		careerPlans: number;
		birthdayReviews: number;
		other: number;
	};
}

// ============================================================
// Service
// ============================================================

/**
 * テナント内のユーザーデータ件数を取得
 */
export async function getDataSummary(_tenantId: string): Promise<DataSummary> {
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle table type is complex
	const countAll = (table: any): number => {
		const row = db.select({ count: sql<number>`count(*)` }).from(table).get();
		return (row as { count: number } | undefined)?.count ?? 0;
	};

	return {
		children: countAll(children),
		activityLogs: countAll(activityLogs),
		pointLedger: countAll(pointLedger),
		statuses: countAll(statuses),
		achievements: countAll(childAchievements),
		titles: countAll(childTitles),
		loginBonuses: countAll(loginBonuses),
		checklistTemplates: countAll(checklistTemplates),
		careerPlans: countAll(careerPlans),
		birthdayReviews: countAll(birthdayReviews),
		avatarItems: countAll(childAvatarItems),
		voices: countAll(childCustomVoices),
	};
}

/**
 * テナント内の全ユーザーデータを削除する
 * システムマスタ（デフォルト活動・実績・称号・アバターアイテム等）は保持
 */
export async function clearAllFamilyData(tenantId: string): Promise<ClearResult> {
	logger.info('[data-clear] データクリア開始', { context: { tenantId } });

	// 1. ファイル削除（子供ごとのアバター・音声・生成画像）
	const allChildren = db.select().from(children).all();
	for (const child of allChildren) {
		try {
			await deleteChildFiles(child.id, tenantId);
		} catch (e) {
			logger.warn(`[data-clear] ファイル削除失敗 childId=${child.id}: ${String(e)}`);
		}
	}

	// 2. トランザクションで全テーブルを削除（FK依存順序に従う）
	const result = db.transaction((tx) => {
		// 依存テーブル先に削除（子テーブル → 親テーブル）
		const r = {
			// スタンプカード関連
			stampEntries: tx.delete(stampEntries).run().changes,
			stampCards: tx.delete(stampCards).run().changes,
			// スキルツリー関連
			childSkillNodes: tx.delete(childSkillNodes).run().changes,
			skillPoints: tx.delete(skillPoints).run().changes,
			// 活動習熟
			activityMastery: tx.delete(activityMastery).run().changes,
			// チェックリスト関連
			checklistOverrides: tx.delete(checklistOverrides).run().changes,
			checklistLogs: tx.delete(checklistLogs).run().changes,
			checklistTemplateItems: tx.delete(checklistTemplateItems).run().changes,
			checklistTemplates: tx.delete(checklistTemplates).run().changes,
			// 報酬・実績関連
			specialRewards: tx.delete(specialRewards).run().changes,
			childAchievements: tx.delete(childAchievements).run().changes,
			childTitles: tx.delete(childTitles).run().changes,
			childAvatarItems: tx.delete(childAvatarItems).run().changes,
			// ボーナス・ミッション
			loginBonuses: tx.delete(loginBonuses).run().changes,
			dailyMissions: tx.delete(dailyMissions).run().changes,
			// 画像・音声
			characterImages: tx.delete(characterImages).run().changes,
			childCustomVoices: tx.delete(childCustomVoices).run().changes,
			// 評価・履歴
			evaluations: tx.delete(evaluations).run().changes,
			statusHistory: tx.delete(statusHistory).run().changes,
			statuses: tx.delete(statuses).run().changes,
			// キャリア
			careerPlanHistory: tx.delete(careerPlanHistory).run().changes,
			careerPlans: tx.delete(careerPlans).run().changes,
			// 誕生日
			birthdayReviews: tx.delete(birthdayReviews).run().changes,
			// 嗜好
			childActivityPreferences: tx.delete(childActivityPreferences).run().changes,
			// 記録
			pointLedger: tx.delete(pointLedger).run().changes,
			activityLogs: tx.delete(activityLogs).run().changes,
			// カスタム称号
			levelTitles: tx.delete(levelTitles).run().changes,
			// 子供（最後）
			children: tx.delete(children).run().changes,
		};
		return r;
	});

	const summary: ClearResult = {
		deleted: {
			children: result.children,
			activityLogs: result.activityLogs,
			pointLedger: result.pointLedger,
			statuses: result.statuses,
			statusHistory: result.statusHistory,
			achievements: result.childAchievements,
			titles: result.childTitles,
			loginBonuses: result.loginBonuses,
			checklistTemplates: result.checklistTemplates,
			careerPlans: result.careerPlans,
			birthdayReviews: result.birthdayReviews,
			other:
				result.stampEntries +
				result.stampCards +
				result.childSkillNodes +
				result.skillPoints +
				result.activityMastery +
				result.checklistOverrides +
				result.checklistLogs +
				result.checklistTemplateItems +
				result.specialRewards +
				result.childAvatarItems +
				result.dailyMissions +
				result.characterImages +
				result.childCustomVoices +
				result.evaluations +
				result.careerPlanHistory +
				result.childActivityPreferences +
				result.levelTitles,
		},
	};

	logger.info('[data-clear] データクリア完了', { context: { ...summary.deleted } });
	return summary;
}
