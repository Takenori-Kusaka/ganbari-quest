// src/lib/server/services/import-service.ts
// 家族データインポートサービス（Phase 2）

import { EXPORT_FORMAT, EXPORT_VERSION, type ExportData } from '$lib/domain/export-format';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import {
	findActivities,
	insertActivity,
	insertActivityLog,
	insertPointLedger,
} from '$lib/server/db/activity-repo';
import { insertTemplate, insertTemplateItem } from '$lib/server/db/checklist-repo';
import { insertChild } from '$lib/server/db/child-repo';
import { insertLoginBonus } from '$lib/server/db/login-bonus-repo';
import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';
import { insertStatusHistory, upsertStatus } from '$lib/server/db/status-repo';
import { logger } from '$lib/server/logger';

// カテゴリコード → ID
const CATEGORY_CODE_TO_ID: Record<string, number> = {};
for (const [i, code] of CATEGORY_CODES.entries()) {
	CATEGORY_CODE_TO_ID[code] = i + 1;
}

export interface ImportResult {
	childrenImported: number;
	activitiesCreated: number;
	activityLogsImported: number;
	activityLogsSkipped: number;
	pointLedgerImported: number;
	pointLedgerSkipped: number;
	statusesImported: number;
	achievementsImported: number;
	titlesImported: number;
	specialRewardsImported: number;
	specialRewardsSkipped: number;
	errors: string[];
	warnings: string[];
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
	const supportedVersions = [EXPORT_VERSION, '1.0.0'];
	if (!supportedVersions.includes(d.version as string)) {
		return {
			valid: false,
			error: `バージョンが不正です（対応: ${supportedVersions.join(', ')}, 実際: ${d.version}）`,
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
		specialRewards: data.data.specialRewards.length,
	};
}

/**
 * 家族データをインポート
 */
export async function importFamilyData(data: ExportData, tenantId: string): Promise<ImportResult> {
	const errors: string[] = [];
	const warnings: string[] = [];
	const result: ImportResult = {
		childrenImported: 0,
		activitiesCreated: 0,
		activityLogsImported: 0,
		activityLogsSkipped: 0,
		pointLedgerImported: 0,
		pointLedgerSkipped: 0,
		statusesImported: 0,
		achievementsImported: 0,
		titlesImported: 0,
		specialRewardsImported: 0,
		specialRewardsSkipped: 0,
		errors,
		warnings,
	};

	logger.info('[import] インポート開始', { context: { tenantId } });

	// 0. マスタデータのインポート（活動マスタ）
	if (data.master?.activities) {
		const existingActivities = await findActivities(tenantId);
		const existingNames = new Set(existingActivities.map((a) => a.name));

		for (const exportActivity of data.master.activities) {
			if (existingNames.has(exportActivity.name)) continue;

			const categoryId = CATEGORY_CODE_TO_ID[exportActivity.categoryCode];
			if (!categoryId) {
				warnings.push(
					`活動「${exportActivity.name}」のカテゴリ「${exportActivity.categoryCode}」が不明のためスキップ`,
				);
				continue;
			}

			try {
				await insertActivity(
					{
						name: exportActivity.name,
						categoryId,
						icon: exportActivity.icon,
						basePoints: exportActivity.basePoints,
						ageMin: null,
						ageMax: null,
						triggerHint: exportActivity.triggerHint,
					},
					tenantId,
				);
				result.activitiesCreated++;
				existingNames.add(exportActivity.name);
			} catch (e) {
				warnings.push(`活動「${exportActivity.name}」の作成に失敗: ${String(e)}`);
			}
		}
	}

	// マスタデータのルックアップ構築
	const activities = await findActivities(tenantId);

	const activityNameMap = new Map(activities.map((a) => [a.name, a]));

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
			await upsertStatus(
				childId,
				categoryId,
				status.totalXp,
				status.level,
				status.peakXp,
				tenantId,
			);
			result.statusesImported++;
		} catch (e) {
			errors.push(
				`ステータスインポート失敗 (${status.childRef}/${status.categoryCode}): ${String(e)}`,
			);
		}
	}

	// 3. 活動ログ
	const missingActivityNames = new Set<string>();
	for (const log of data.data.activityLogs) {
		const childId = childIdMap.get(log.childRef);
		if (!childId) continue;

		const activity = activityNameMap.get(log.activityName);
		if (!activity) {
			result.activityLogsSkipped++;
			if (!missingActivityNames.has(log.activityName)) {
				missingActivityNames.add(log.activityName);
				warnings.push(`活動ログスキップ: 活動「${log.activityName}」がマスタに見つかりません`);
			}
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
		if (!childId) {
			result.pointLedgerSkipped++;
			continue;
		}

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
			result.pointLedgerSkipped++;
		}
	}

	// 5. 実績 — 実績システム廃止（#322）— スキップ
	// 6. 称号 — 称号システム廃止（#322）— スキップ

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

	// 8. チェックリストテンプレート
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

	// 9. 特別報酬 (ごほうび) (#1253)
	await importSpecialRewards(data, childIdMap, tenantId, result);

	// 10. ステータス履歴
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

async function importSpecialRewards(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const { errors, warnings } = result;
	const existingRewardsByChild = new Map<number, Set<string>>();
	for (const sr of data.data.specialRewards) {
		const childId = childIdMap.get(sr.childRef);
		if (!childId) continue;

		if (!existingRewardsByChild.has(childId)) {
			const existing = await findSpecialRewards(childId, tenantId);
			existingRewardsByChild.set(childId, new Set(existing.map((e) => e.title)));
		}
		const existingTitles = existingRewardsByChild.get(childId);
		if (!existingTitles) continue;

		if (existingTitles.has(sr.title)) {
			result.specialRewardsSkipped++;
			continue;
		}

		try {
			await insertSpecialReward(
				{
					childId,
					title: sr.title,
					description: sr.description ?? undefined,
					points: sr.points,
					icon: sr.icon ?? undefined,
					category: sr.category,
				},
				tenantId,
			);
			result.specialRewardsImported++;
			existingTitles.add(sr.title);
		} catch (e) {
			errors.push(`ごほうび「${sr.title}」のインポートに失敗: ${String(e)}`);
		}
	}
	if (result.specialRewardsSkipped > 0) {
		warnings.push(
			`ごほうび ${result.specialRewardsSkipped} 件が既存と同名のためスキップされました`,
		);
	}
}
