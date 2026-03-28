// src/lib/server/services/import-service.ts
// 家族データインポートサービス（Phase 2）

import { EXPORT_FORMAT, EXPORT_VERSION, type ExportData } from '$lib/domain/export-format';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { findAllAchievements, insertChildAchievement } from '$lib/server/db/achievement-repo';
import { findActivities, insertActivityLog, insertPointLedger } from '$lib/server/db/activity-repo';
import { findAllAvatarItems, insertChildAvatarItem } from '$lib/server/db/avatar-repo';
import { insertBirthdayReview } from '$lib/server/db/birthday-repo';
import { findAllCareerFields, insertCareerPlan } from '$lib/server/db/career-repo';
import { insertTemplate, insertTemplateItem } from '$lib/server/db/checklist-repo';
import { insertChild } from '$lib/server/db/child-repo';
import { insertLoginBonus } from '$lib/server/db/login-bonus-repo';
import { insertStatusHistory, upsertStatus } from '$lib/server/db/status-repo';
import { findAllTitles, insertChildTitle } from '$lib/server/db/title-repo';
import { logger } from '$lib/server/logger';

// カテゴリコード → ID
const CATEGORY_CODE_TO_ID: Record<string, number> = {};
for (const [i, code] of CATEGORY_CODES.entries()) {
	CATEGORY_CODE_TO_ID[code] = i + 1;
}

export interface ImportResult {
	childrenImported: number;
	activityLogsImported: number;
	pointLedgerImported: number;
	statusesImported: number;
	achievementsImported: number;
	titlesImported: number;
	errors: string[];
}

/**
 * エクスポートJSONのバリデーション
 */
export function validateExportData(
	data: unknown,
): { valid: true; data: ExportData } | { valid: false; error: string } {
	if (!data || typeof data !== 'object') {
		return { valid: false, error: 'JSONオブジェクトが不正です' };
	}

	const d = data as Record<string, unknown>;

	if (d.format !== EXPORT_FORMAT) {
		return { valid: false, error: `フォーマットが不正です（期待: ${EXPORT_FORMAT}）` };
	}
	if (d.version !== EXPORT_VERSION) {
		return {
			valid: false,
			error: `バージョンが不正です（期待: ${EXPORT_VERSION}, 実際: ${d.version}）`,
		};
	}
	if (!d.family || typeof d.family !== 'object') {
		return { valid: false, error: 'family データがありません' };
	}

	const family = d.family as Record<string, unknown>;
	if (!Array.isArray(family.children) || family.children.length === 0) {
		return { valid: false, error: '子供データがありません' };
	}

	if (!d.data || typeof d.data !== 'object') {
		return { valid: false, error: 'data セクションがありません' };
	}

	return { valid: true, data: data as ExportData };
}

/**
 * インポートデータのプレビュー（件数のみ返す）
 */
export function previewImport(data: ExportData) {
	return {
		children: data.family.children.length,
		activityLogs: data.data.activityLogs.length,
		pointLedger: data.data.pointLedger.length,
		statuses: data.data.statuses.length,
		achievements: data.data.childAchievements.length,
		titles: data.data.childTitles.length,
		loginBonuses: data.data.loginBonuses.length,
		checklistTemplates: data.data.checklistTemplates.length,
		avatarItems: data.data.childAvatarItems.length,
		careerPlans: data.data.careerPlans.length,
		birthdayReviews: data.data.birthdayReviews.length,
	};
}

/**
 * 家族データをインポート
 */
export async function importFamilyData(data: ExportData, tenantId: string): Promise<ImportResult> {
	const errors: string[] = [];
	const result: ImportResult = {
		childrenImported: 0,
		activityLogsImported: 0,
		pointLedgerImported: 0,
		statusesImported: 0,
		achievementsImported: 0,
		titlesImported: 0,
		errors,
	};

	logger.info('[import] インポート開始', { context: { tenantId } });

	// マスタデータのルックアップ構築
	const [activities, titles, achievements, avatarItems, careerFields] = await Promise.all([
		findActivities(tenantId),
		findAllTitles(tenantId),
		findAllAchievements(tenantId),
		findAllAvatarItems(tenantId),
		findAllCareerFields(tenantId),
	]);

	const activityNameMap = new Map(activities.map((a) => [a.name, a]));
	const titleCodeMap = new Map(titles.map((t) => [t.code, t]));
	const achievementCodeMap = new Map(achievements.map((a) => [a.code, a]));
	const avatarCodeMap = new Map(avatarItems.map((a) => [a.code, a]));
	const careerFieldNameMap = new Map(careerFields.map((f) => [f.name, f]));

	// 1. 子供を作成し、exportId → newChildId のマッピングを構築
	const childIdMap = new Map<string, number>();

	for (const exportChild of data.family.children) {
		try {
			const child = await insertChild(
				{
					nickname: exportChild.nickname,
					age: exportChild.age,
					theme: exportChild.theme,
					uiMode: exportChild.uiMode,
					birthDate: exportChild.birthDate ?? undefined,
				},
				tenantId,
			);
			childIdMap.set(exportChild.exportId, child.id);
			result.childrenImported++;
		} catch (e) {
			errors.push(`子供「${exportChild.nickname}」の作成に失敗: ${String(e)}`);
		}
	}

	if (childIdMap.size === 0) {
		errors.push('子供の作成が全て失敗しました');
		return result;
	}

	// 2. ステータス
	for (const status of data.data.statuses) {
		const childId = childIdMap.get(status.childRef);
		const categoryId = CATEGORY_CODE_TO_ID[status.categoryCode];
		if (!childId || !categoryId) continue;

		try {
			await upsertStatus(childId, categoryId, status.value, tenantId);
			result.statusesImported++;
		} catch (e) {
			errors.push(
				`ステータスインポート失敗 (${status.childRef}/${status.categoryCode}): ${String(e)}`,
			);
		}
	}

	// 3. 活動ログ
	for (const log of data.data.activityLogs) {
		const childId = childIdMap.get(log.childRef);
		if (!childId) continue;

		const activity = activityNameMap.get(log.activityName);
		if (!activity) {
			// 活動マスタが見つからない場合はスキップ
			continue;
		}

		try {
			await insertActivityLog(
				{
					childId,
					activityId: activity.id,
					points: log.points,
					streakDays: log.streakDays,
					streakBonus: log.streakBonus,
					recordedDate: log.recordedDate,
					recordedAt: log.recordedAt,
				},
				tenantId,
			);
			result.activityLogsImported++;
		} catch (_e) {
			// 重複等のエラーはスキップ
		}
	}

	// 4. ポイント台帳
	for (const entry of data.data.pointLedger) {
		const childId = childIdMap.get(entry.childRef);
		if (!childId) continue;

		try {
			await insertPointLedger(
				{
					childId,
					amount: entry.amount,
					type: entry.type,
					description: entry.description ?? '',
				},
				tenantId,
			);
			result.pointLedgerImported++;
		} catch (_e) {
			// skip
		}
	}

	// 5. 実績
	for (const ca of data.data.childAchievements) {
		const childId = childIdMap.get(ca.childRef);
		if (!childId) continue;

		const achievement = achievementCodeMap.get(ca.achievementCode);
		if (!achievement) continue;

		try {
			await insertChildAchievement(childId, achievement.id, tenantId, ca.milestoneValue);
			result.achievementsImported++;
		} catch (_e) {
			// skip duplicate
		}
	}

	// 6. 称号
	for (const ct of data.data.childTitles) {
		const childId = childIdMap.get(ct.childRef);
		if (!childId) continue;

		const title = titleCodeMap.get(ct.titleCode);
		if (!title) continue;

		try {
			await insertChildTitle(childId, title.id, tenantId);
			result.titlesImported++;
		} catch (_e) {
			// skip duplicate
		}
	}

	// 7. ログインボーナス
	for (const lb of data.data.loginBonuses) {
		const childId = childIdMap.get(lb.childRef);
		if (!childId) continue;

		try {
			await insertLoginBonus(
				{
					childId,
					loginDate: lb.loginDate,
					rank: lb.rank,
					basePoints: lb.basePoints,
					multiplier: lb.multiplier,
					totalPoints: lb.totalPoints,
					consecutiveDays: lb.consecutiveDays,
				},
				tenantId,
			);
		} catch (_e) {
			// skip duplicate
		}
	}

	// 8. きせかえアイテム所持
	for (const oi of data.data.childAvatarItems) {
		const childId = childIdMap.get(oi.childRef);
		if (!childId) continue;

		const item = avatarCodeMap.get(oi.itemCode);
		if (!item) continue;

		try {
			await insertChildAvatarItem(childId, item.id, tenantId);
		} catch (_e) {
			// skip duplicate
		}
	}

	// 9. チェックリストテンプレート
	for (const tpl of data.data.checklistTemplates) {
		const childId = childIdMap.get(tpl.childRef);
		if (!childId) continue;

		try {
			const newTpl = await insertTemplate(
				{
					childId,
					name: tpl.name,
					icon: tpl.icon,
					pointsPerItem: tpl.pointsPerItem,
					completionBonus: tpl.completionBonus,
					isActive: tpl.isActive ? 1 : 0,
				},
				tenantId,
			);
			for (const item of tpl.items) {
				await insertTemplateItem(
					{
						templateId: newTpl.id,
						name: item.name,
						icon: item.icon,
						frequency: item.frequency,
						direction: item.direction,
						sortOrder: item.sortOrder,
					},
					tenantId,
				);
			}
		} catch (e) {
			errors.push(`チェックリスト「${tpl.name}」インポート失敗: ${String(e)}`);
		}
	}

	// 10. キャリアプラン
	for (const cp of data.data.careerPlans) {
		const childId = childIdMap.get(cp.childRef);
		if (!childId) continue;

		const field = cp.careerFieldName ? careerFieldNameMap.get(cp.careerFieldName) : null;
		try {
			await insertCareerPlan(
				{
					childId,
					careerFieldId: field?.id ?? undefined,
					dreamText: cp.dreamText ?? undefined,
					mandalaChart: cp.mandalaChart,
					timeline3y: cp.timeline3y ?? undefined,
					timeline5y: cp.timeline5y ?? undefined,
					timeline10y: cp.timeline10y ?? undefined,
				},
				tenantId,
			);
		} catch (_e) {
			// skip
		}
	}

	// 11. 誕生日振り返り
	for (const br of data.data.birthdayReviews) {
		const childId = childIdMap.get(br.childRef);
		if (!childId) continue;

		try {
			await insertBirthdayReview(
				{
					childId,
					reviewYear: br.reviewYear,
					ageAtReview: br.ageAtReview,
					healthChecks: br.healthChecks,
					aspirationText: br.aspirationText,
					aspirationCategories: br.aspirationCategories,
					basePoints: br.basePoints,
					healthPoints: br.healthPoints,
					aspirationPoints: br.aspirationPoints,
					totalPoints: br.totalPoints,
				},
				tenantId,
			);
		} catch (_e) {
			// skip duplicate
		}
	}

	// 12. ステータス履歴
	for (const sh of data.data.statusHistory) {
		const childId = childIdMap.get(sh.childRef);
		const categoryId = CATEGORY_CODE_TO_ID[sh.categoryCode];
		if (!childId || !categoryId) continue;

		try {
			await insertStatusHistory(
				{
					childId,
					categoryId,
					value: sh.value,
					changeAmount: sh.changeAmount,
					changeType: sh.changeType,
				},
				tenantId,
			);
		} catch (_e) {
			// skip
		}
	}

	logger.info('[import] インポート完了', { context: { ...result } });
	return result;
}
