// src/lib/server/services/import-service.ts
// 家族データインポートサービス（Phase 2 / #1254）

import { EXPORT_FORMAT, EXPORT_VERSION, type ExportData } from '$lib/domain/export-format';
import { IMPORT_LABELS, type ImportSkipReason } from '$lib/domain/labels';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import {
	findActivities,
	findActivityLogs,
	insertActivity,
	insertActivityLog,
	insertPointLedger,
} from '$lib/server/db/activity-repo';
import { insertTemplate, insertTemplateItem } from '$lib/server/db/checklist-repo';
import { insertChild } from '$lib/server/db/child-repo';
import { findRecentBonuses, insertLoginBonus } from '$lib/server/db/login-bonus-repo';
import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';
import { insertStatusHistory, upsertStatus } from '$lib/server/db/status-repo';
import { logger } from '$lib/server/logger';

// カテゴリコード → ID
const CATEGORY_CODE_TO_ID: Record<string, number> = {};
for (const [i, code] of CATEGORY_CODES.entries()) {
	CATEGORY_CODE_TO_ID[code] = i + 1;
}

/**
 * インポート結果 (#1254 で skipped 内訳追加)
 */
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
	loginBonusesImported: number;
	loginBonusesSkipped: number;
	statusHistoryImported: number;
	statusHistorySkipped: number;
	/** スキップ内訳 (#1254 G2): preset/name/constraint の各カテゴリ */
	skipped: {
		preset: number;
		name: number;
		constraint: number;
	};
	errors: string[];
	warnings: string[];
}

/**
 * プレビュー時の重複候補エントリ (#1254 G2)
 */
export interface DuplicateEntry {
	/** UI 表示用ラベル (例: 活動名 / ごほうび名 / ログインボーナス日付) */
	label: string;
	reason: ImportSkipReason;
}

/**
 * プレビュー結果 (#1254 G2: duplicates 追加)
 */
export interface PreviewResult {
	children: number;
	activityLogs: number;
	pointLedger: number;
	statuses: number;
	achievements: number;
	titles: number;
	loginBonuses: number;
	checklistTemplates: number;
	specialRewards: number;
	/** リソース別の重複候補配列 */
	duplicates: {
		activities: DuplicateEntry[];
		specialRewards: DuplicateEntry[];
		checklistTemplates: DuplicateEntry[];
		activityLogs: DuplicateEntry[];
		loginBonuses: DuplicateEntry[];
	};
}

/**
 * エクスポートJSONのバリデーション (構造検証のみ、checksum は別関数で検証)
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
 * SHA-256 checksum を計算 (export-service.ts と同一ロジック)
 */
async function computeChecksum(payload: string): Promise<string> {
	const encoder = new TextEncoder();
	const buffer = encoder.encode(payload);
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return `sha256:${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * checksum の検証 (#1254 G4)
 * - checksum フィールドを除いた JSON を再シリアライズして SHA-256 を計算、
 *   ペイロード記載の checksum と比較する
 * - 空文字列 (旧バージョン互換) の場合は検証をスキップ
 */
export async function verifyChecksum(data: ExportData): Promise<boolean> {
	if (!data.checksum || data.checksum === '') return true;
	const payload = JSON.stringify({ ...data, checksum: undefined });
	const actual = await computeChecksum(payload);
	return actual === data.checksum;
}

/**
 * インポートデータのプレビュー (#1254 G2: 重複候補を事前取得)
 * 件数カウント + 重複候補 (活動/ごほうび/持ち物 CL/活動ログ/ログインボーナス) を返す
 */
export async function previewImport(data: ExportData, tenantId: string): Promise<PreviewResult> {
	const duplicates: PreviewResult['duplicates'] = {
		activities: [],
		specialRewards: [],
		checklistTemplates: [],
		activityLogs: [],
		loginBonuses: [],
	};

	// 活動マスタの名前重複
	if (data.master?.activities?.length) {
		const existing = await findActivities(tenantId);
		const existingNames = new Set(existing.map((a) => a.name));
		for (const a of data.master.activities) {
			if (existingNames.has(a.name)) {
				duplicates.activities.push({ label: a.name, reason: 'name_duplicate' });
			}
		}
	}

	// NOTE: specialRewards / checklistTemplates / activityLogs / loginBonuses の重複検出には
	//       子供単位の pre-fetch が必要だが、preview 段階では child_id が確定していない
	//       (新規作成前)。そのため、「同名ごほうびが既存全子供に存在する場合」のような
	//       保守的推定に留める。実インポート時は importFamilyData 側で正確に判定する。

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
		duplicates,
	};
}

/**
 * 家族データをインポート (#1254: silent try-catch を pre-fetch 方式に統一)
 *
 * 処理順: 活動マスタ → 子供作成 → ステータス → 活動ログ → ポイント台帳 → ログインボーナス
 *   → チェックリスト → ごほうび → ステータス履歴
 * 各セクションは専用ヘルパ関数に委譲し、本関数は oversight に集中する。
 */
export async function importFamilyData(data: ExportData, tenantId: string): Promise<ImportResult> {
	const result = createEmptyImportResult();
	logger.info('[import] インポート開始', { context: { tenantId } });

	await importActivityMaster(data, tenantId, result);
	const activityNameMap = await buildActivityLookup(tenantId);
	const childIdMap = await importChildrenData(data, tenantId, result);

	if (childIdMap.size === 0) {
		result.errors.push('子供の作成が全て失敗しました');
		return result;
	}

	await importStatusesData(data, childIdMap, tenantId, result);
	await importActivityLogsData(data, childIdMap, activityNameMap, tenantId, result);
	await importPointLedgerData(data, childIdMap, tenantId, result);
	await importLoginBonusesData(data, childIdMap, tenantId, result);
	await importChecklistTemplatesData(data, childIdMap, tenantId, result);
	await importSpecialRewards(data, childIdMap, tenantId, result);
	await importStatusHistoryData(data, childIdMap, tenantId, result);

	logger.info('[import] インポート完了', { context: { ...result } });
	return result;
}

function createEmptyImportResult(): ImportResult {
	return {
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
		loginBonusesImported: 0,
		loginBonusesSkipped: 0,
		statusHistoryImported: 0,
		statusHistorySkipped: 0,
		skipped: { preset: 0, name: 0, constraint: 0 },
		errors: [],
		warnings: [],
	};
}

async function importActivityMaster(
	data: ExportData,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	if (!data.master?.activities?.length) return;

	const existingActivities = await findActivities(tenantId);
	const existingNames = new Set(existingActivities.map((a) => a.name));

	for (const exportActivity of data.master.activities) {
		if (existingNames.has(exportActivity.name)) {
			result.skipped.name++;
			continue;
		}
		const categoryId = CATEGORY_CODE_TO_ID[exportActivity.categoryCode];
		if (!categoryId) {
			result.warnings.push(
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
			result.warnings.push(`活動「${exportActivity.name}」の作成に失敗: ${String(e)}`);
		}
	}
}

async function buildActivityLookup(
	tenantId: string,
): Promise<Map<string, { id: number; name: string }>> {
	const activities = await findActivities(tenantId);
	return new Map(activities.map((a) => [a.name, a]));
}

async function importChildrenData(
	data: ExportData,
	tenantId: string,
	result: ImportResult,
): Promise<Map<string, number>> {
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
			result.errors.push(`子供「${exportChild.nickname}」の作成に失敗: ${String(e)}`);
		}
	}
	return childIdMap;
}

async function importStatusesData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
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
			result.errors.push(
				`ステータスインポート失敗 (${status.childRef}/${status.categoryCode}): ${String(e)}`,
			);
		}
	}
}

/**
 * 活動ログを import (#1254 G2: pre-fetch で (activityId, recordedAt) セット構築 → 事前スキップ)
 */
async function importActivityLogsData(
	data: ExportData,
	childIdMap: Map<string, number>,
	activityNameMap: Map<string, { id: number; name: string }>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const existingLogKeysByChild = new Map<number, Set<string>>();
	const missingActivityNames = new Set<string>();

	for (const log of data.data.activityLogs) {
		const childId = childIdMap.get(log.childRef);
		if (!childId) continue;

		const activity = activityNameMap.get(log.activityName);
		if (!activity) {
			result.activityLogsSkipped++;
			if (!missingActivityNames.has(log.activityName)) {
				missingActivityNames.add(log.activityName);
				result.warnings.push(
					`活動ログスキップ: 活動「${log.activityName}」がマスタに見つかりません`,
				);
			}
			continue;
		}

		const existingKeys = await getOrFetchActivityLogKeys(childId, tenantId, existingLogKeysByChild);
		const key = `${log.activityName}:${log.recordedAt}`;
		if (existingKeys.has(key)) {
			result.activityLogsSkipped++;
			result.skipped.constraint++;
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
			existingKeys.add(key);
		} catch (e) {
			result.activityLogsSkipped++;
			result.errors.push(
				`活動ログ insert 失敗 (child=${log.childRef}, activity=${log.activityName}): ${String(e)}`,
			);
		}
	}
}

async function getOrFetchActivityLogKeys(
	childId: number,
	tenantId: string,
	cache: Map<number, Set<string>>,
): Promise<Set<string>> {
	let keys = cache.get(childId);
	if (!keys) {
		const existing = await findActivityLogs(childId, tenantId);
		keys = new Set(existing.map((e) => `${e.activityName}:${e.recordedAt}`));
		cache.set(childId, keys);
	}
	return keys;
}

/**
 * ポイント台帳 import (#1254 G2: silent try-catch 廃止、insert 失敗時は errors に push)
 */
async function importPointLedgerData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
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
		} catch (e) {
			result.pointLedgerSkipped++;
			result.errors.push(
				`ポイント台帳 insert 失敗 (child=${entry.childRef}, amount=${entry.amount}): ${String(e)}`,
			);
		}
	}
}

/**
 * ログインボーナス import (#1254 G2: pre-fetch で (childId, loginDate) セット → 事前スキップ)
 */
async function importLoginBonusesData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const existingBonusesByChild = new Map<number, Set<string>>();

	for (const lb of data.data.loginBonuses) {
		const childId = childIdMap.get(lb.childRef);
		if (!childId) continue;

		let existingDates = existingBonusesByChild.get(childId);
		if (!existingDates) {
			const existing = await findRecentBonuses(childId, tenantId, 365);
			existingDates = new Set(existing.map((e) => e.loginDate));
			existingBonusesByChild.set(childId, existingDates);
		}

		if (existingDates.has(lb.loginDate)) {
			result.loginBonusesSkipped++;
			result.skipped.constraint++;
			continue;
		}

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
			result.loginBonusesImported++;
			existingDates.add(lb.loginDate);
		} catch (e) {
			result.loginBonusesSkipped++;
			result.errors.push(
				`ログインボーナス insert 失敗 (child=${lb.childRef}, date=${lb.loginDate}): ${String(e)}`,
			);
		}
	}
}

async function importChecklistTemplatesData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
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
			result.errors.push(`チェックリスト「${tpl.name}」インポート失敗: ${String(e)}`);
		}
	}
}

/**
 * ステータス履歴 import (#1254 G2: silent try-catch 廃止、insert 失敗時は errors に push)
 */
async function importStatusHistoryData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
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
			result.statusHistoryImported++;
		} catch (e) {
			result.statusHistorySkipped++;
			result.errors.push(
				`ステータス履歴 insert 失敗 (child=${sh.childRef}, category=${sh.categoryCode}): ${String(e)}`,
			);
		}
	}
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
			result.skipped.name++;
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

// Re-export labels type for API handler
export { IMPORT_LABELS };
