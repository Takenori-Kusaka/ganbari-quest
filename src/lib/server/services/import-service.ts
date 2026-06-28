// src/lib/server/services/import-service.ts
// 家族データインポートサービス（Phase 2 / #1254）

import {
	EXPORT_FORMAT,
	EXPORT_VERSION,
	type ExportData,
	isExportableSettingKey,
} from '$lib/domain/export-format';
import { IMPORT_LABELS, type ImportSkipReason } from '$lib/domain/labels';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import {
	findActivities,
	findActivityLogs,
	insertActivityLog,
	insertPointLedger,
} from '$lib/server/db/activity-repo';
import {
	assignTemplateToChildren,
	findLogsByChild,
	findTemplatesByChild,
	insertTemplate,
	insertTemplateItem,
	upsertLog,
} from '$lib/server/db/checklist-repo';
import { insertChild } from '$lib/server/db/child-repo';
import { insertEvaluation } from '$lib/server/db/evaluation-repo';
import { getRepos } from '$lib/server/db/factory';
import { updateChildAvatarUrl } from '$lib/server/db/image-repo';
import { findRecentBonuses, insertLoginBonus } from '$lib/server/db/login-bonus-repo';
import { insertRedemptionForRestore } from '$lib/server/db/reward-redemption-repo';
import { setSetting } from '$lib/server/db/settings-repo';
import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';
import { insertStatusHistory, upsertStatus } from '$lib/server/db/status-repo';
import { logger } from '$lib/server/logger';
import { fileExists, saveFile } from '$lib/server/storage';
import { storageKeyToPublicUrl, tenantPrefix } from '$lib/server/storage-keys';

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
	/** #3329: ごほうびショップ交換/購入履歴の取込件数 */
	rewardRedemptionsImported: number;
	rewardRedemptionsSkipped: number;
	/** #3329: per-child チャレンジ instance の取込件数 (auto:weekly 含む) */
	childChallengesImported: number;
	childChallengesSkipped: number;
	/** #3329: スタンプカード / 押印 entry の取込件数 */
	stampCardsImported: number;
	stampCardsSkipped: number;
	stampEntriesImported: number;
	stampEntriesSkipped: number;
	loginBonusesImported: number;
	loginBonusesSkipped: number;
	statusHistoryImported: number;
	statusHistorySkipped: number;
	/** #3327/#3328: 評価 (週次評価) の取込件数 */
	evaluationsImported: number;
	evaluationsSkipped: number;
	/** #3078: チェックリスト完了履歴 */
	checklistLogsImported: number;
	checklistLogsSkipped: number;
	/** #3329: 各種設定 (allowlist 済キーのみ取込)。skip = allowlist 外で書き戻し拒否したキー */
	settingsImported: number;
	settingsSkipped: number;
	/** #3077: ZIP 同梱の静的ファイル (アバター画像 / 音声) の復元件数 */
	staticFilesRestored: number;
	staticFilesSkipped: number;
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
	// #3106/#3107: EXPORT_VERSION を 1.3.0 に bump したが、既存 1.2.0 backup も import 可能に保つ
	// (新 field はすべて optional で後方互換)。
	const supportedVersions = [EXPORT_VERSION, '1.3.0', '1.2.0', '1.1.0', '1.0.0'];
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

	// 活動マスタの重複 (#1254 G1: preset_duplicate 優先、次点 name_duplicate)
	if (data.master?.activities?.length) {
		const existing = await findActivities(tenantId);
		const existingNames = new Set(existing.map((a) => a.name));
		const existingPresetIds = new Set(
			existing.map((a) => a.sourcePresetId).filter((p): p is string => !!p),
		);
		for (const a of data.master.activities) {
			if (a.sourcePresetId && existingPresetIds.has(a.sourcePresetId)) {
				duplicates.activities.push({ label: a.name, reason: 'preset_duplicate' });
			} else if (existingNames.has(a.name)) {
				duplicates.activities.push({ label: a.name, reason: 'name_duplicate' });
			}
		}
	}

	// NOTE: activityLogs / loginBonuses の重複検出には子供単位の pre-fetch が必要だが、
	//       preview 段階では child_id が確定していない (新規作成前)。
	//       実インポート時は importFamilyData 側で正確に判定する。

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
 *   → チェックリスト → ごほうび → ステータス履歴 → 静的ファイル復元
 * 各セクションは専用ヘルパ関数に委譲し、本関数は oversight に集中する。
 *
 * @param staticFiles #3077: ZIP 同梱の静的ファイル (相対パス → bytes)。
 *   JSON のみインポート時は undefined (後方互換)。
 */
export async function importFamilyData(
	data: ExportData,
	tenantId: string,
	staticFiles?: Record<string, Uint8Array>,
): Promise<ImportResult> {
	const result = createEmptyImportResult();
	logger.info('[import] インポート開始', { context: { tenantId } });

	// #3327 P3: 子を先に作成し childIdMap を確定してから per-child 活動を復元する
	// (旧実装は活動を子より先に import → replace で子ゼロ時に insertActivity が throw → 全活動喪失)。
	const childIdMap = await importChildrenData(data, tenantId, result);

	if (childIdMap.size === 0) {
		result.errors.push('子供の作成が全て失敗しました');
		return result;
	}

	// #3327 P3: per-child 活動を元の子へ復元 (master flatten の first-child 一律 bind を廃止)。
	await importChildActivitiesData(data, childIdMap, tenantId, result);
	// #3327: 活動ログ remap 用の lookup は (childId, name) の 2 軸で構築する。name のみ lookup は
	// 兄弟同名活動を 1 件に縮約 (last-wins) し child1 のログを child2 の activity に bind する
	// cross-child 誤 bind を生む (ADR-0055 per-child 境界侵害)。per-child 活動 insert 後に構築する。
	const activityLookupByChild = await buildActivityLookupByChild(childIdMap, tenantId);

	await importStatusesData(data, childIdMap, tenantId, result);
	await importActivityLogsData(data, childIdMap, activityLookupByChild, tenantId, result);
	await importPointLedgerData(data, childIdMap, tenantId, result);
	await importLoginBonusesData(data, childIdMap, tenantId, result);
	const templateIdMap = await importChecklistTemplatesData(data, childIdMap, tenantId, result);
	await importChecklistLogsData(data, childIdMap, templateIdMap, tenantId, result);
	await importSpecialRewards(data, childIdMap, tenantId, result);
	// #3329: ごほうび交換/購入履歴。reward を先に取込済 (FK rewardRef → rewardId を再解決) なので
	// importSpecialRewards の後に実行する。
	await importRewardRedemptionsData(data, childIdMap, tenantId, result);
	// #3329: per-child チャレンジ (auto:weekly 含む) を進捗/完了/請求保全で復元。childIdMap のみ必要。
	await importChildChallengesData(data, childIdMap, tenantId, result);
	// #3329: スタンプカード + 押印。card を復元 → 新 cardId に entry を貼り直す。childIdMap のみ必要。
	await importStampCardsData(data, childIdMap, tenantId, result);
	await importStatusHistoryData(data, childIdMap, tenantId, result);
	// #3327/#3328: 評価 (週次評価) の取込。従来 import 関数が無く restore で全喪失していた網羅漏れを解消。
	await importEvaluationsData(data, childIdMap, tenantId, result);
	// #3329: 各種設定 (tenant-scoped KVS)。allowlist 再 filter で秘匿キーを書き戻さない多層防御。
	await importSettingsData(data, tenantId, result);

	// #3077: ZIP 同梱の静的ファイル (アバター画像 / 音声) を新 childId に再マップして復元。
	if (staticFiles && Object.keys(staticFiles).length > 0) {
		await importStaticFiles(data, childIdMap, staticFiles, tenantId, result);
	}

	logger.info('[import] インポート完了', { context: { ...result } });
	return result;
}

/**
 * 評価 (週次評価) を元の子へ復元する (#3327/#3328)。
 * 従来 importFamilyData に評価の取込経路が無く、export には含まれるのに restore で全喪失していた
 * 網羅漏れ (本番 t-82c17558 で評価 22→0 を実証) を解消する。
 */
async function importEvaluationsData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	for (const ev of data.data.evaluations ?? []) {
		const childId = childIdMap.get(ev.childRef);
		if (!childId) {
			result.evaluationsSkipped++;
			continue;
		}
		try {
			await insertEvaluation(
				{
					childId,
					weekStart: ev.weekStart,
					weekEnd: ev.weekEnd,
					scoresJson: ev.scoresJson,
					bonusPoints: ev.bonusPoints,
				},
				tenantId,
			);
			result.evaluationsImported++;
		} catch (e) {
			result.evaluationsSkipped++;
			result.errors.push(
				`評価 insert 失敗 (child=${ev.childRef}, week=${ev.weekStart}): ${String(e)}`,
			);
		}
	}
}

/**
 * ごほうびショップ交換/購入履歴を復元する (#3329)。
 * FK rewardId は import で振り直されるため、export の `rewardRef` (reward title) を取込先 child の
 * reward 一覧から再解決して結合する。reward が解決できない行 (元 reward 未取込/同名衝突) は
 * skip + warning (FK NOT NULL を満たせないため。残高への影響は別途 pointLedger が真実を持つ)。
 * status / 解決情報 / snapshot は insertRedemptionForRestore で申請時点のまま書き戻す。
 */
async function importRewardRedemptionsData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const redemptions = data.data.rewardRedemptions ?? [];
	if (redemptions.length === 0) return;

	// 取込先 child ごとに reward title → rewardId の lookup を構築する (新規 insert + 既存 dedup 双方を含む)。
	const rewardIdByChildTitle = new Map<number, Map<string, number>>();
	async function rewardLookup(childId: number): Promise<Map<string, number>> {
		let map = rewardIdByChildTitle.get(childId);
		if (!map) {
			const rows = await findSpecialRewards(childId, tenantId);
			map = new Map(rows.map((r) => [r.title, r.id]));
			rewardIdByChildTitle.set(childId, map);
		}
		return map;
	}

	for (const r of redemptions) {
		const childId = childIdMap.get(r.childRef);
		if (!childId) {
			result.rewardRedemptionsSkipped++;
			continue;
		}
		const rewardId = (await rewardLookup(childId)).get(r.rewardRef);
		if (!rewardId) {
			result.rewardRedemptionsSkipped++;
			result.warnings.push(
				`交換履歴スキップ: ごほうび「${r.rewardRef}」(child=${r.childRef}) が取込先に見つかりません`,
			);
			continue;
		}
		try {
			await insertRedemptionForRestore(
				{
					childId,
					rewardId,
					requestedAt: r.requestedAt,
					status: r.status,
					parentNote: r.parentNote,
					resolvedAt: r.resolvedAt,
					resolvedByParentId: r.resolvedByParentId,
					shownToChildAt: r.shownToChildAt,
					rewardTitle: r.rewardTitle,
					rewardPoints: r.rewardPoints,
					rewardIcon: r.rewardIcon,
				},
				tenantId,
			);
			result.rewardRedemptionsImported++;
		} catch (e) {
			result.rewardRedemptionsSkipped++;
			result.errors.push(
				`交換履歴 insert 失敗 (child=${r.childRef}, reward=${r.rewardRef}): ${String(e)}`,
			);
		}
	}
}

/**
 * 各種設定 (tenant-scoped KVS) を復元する (#3329)。
 * export 側で allowlist (EXPORTABLE_SETTING_KEYS) 済だが、import でも `isExportableSettingKey` で
 * **再 filter** する (改竄 backup / 旧 backup に pin_hash・session_token 等が混在しても書き戻さない
 * 多層防御、CWE-522/916・設計 D3)。allowlist 外キーは settingsSkipped として可視化する。
 */
async function importSettingsData(
	data: ExportData,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	for (const s of data.data.settings ?? []) {
		if (!isExportableSettingKey(s.key)) {
			// 秘匿 / 非 allowlist キーは書き戻さない (多層防御)。
			result.settingsSkipped++;
			result.warnings.push(`設定「${s.key}」は backup 対象外のためスキップしました`);
			continue;
		}
		try {
			await setSetting(s.key, s.value, tenantId);
			result.settingsImported++;
		} catch (e) {
			result.settingsSkipped++;
			result.errors.push(`設定「${s.key}」の取込に失敗: ${String(e)}`);
		}
	}
}

/**
 * per-child チャレンジ instance を復元する (#3329)。
 * childId は import で振り直されるため childRef で取込先 child に解決し、insertForRestore で
 * 進捗 (currentValue/completed) / 請求 (rewardClaimed) / status / 日時を申請時点のまま書き戻す。
 * auto:weekly 行 (sourceTemplateId='auto:weekly') も同テーブルの行として保全される。
 */
async function importChildChallengesData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	for (const c of data.data.childChallenges ?? []) {
		const childId = childIdMap.get(c.childRef);
		if (!childId) {
			result.childChallengesSkipped++;
			continue;
		}
		try {
			await getRepos().childChallenge.insertForRestore(
				{
					childId,
					title: c.title,
					description: c.description,
					challengeType: c.challengeType,
					periodType: c.periodType,
					startDate: c.startDate,
					endDate: c.endDate,
					targetConfig: c.targetConfig,
					rewardConfig: c.rewardConfig,
					status: c.status,
					isActive: c.isActive,
					sourceTemplateId: c.sourceTemplateId,
					currentValue: c.currentValue,
					targetValue: c.targetValue,
					completed: c.completed,
					completedAt: c.completedAt,
					rewardClaimed: c.rewardClaimed,
					rewardClaimedAt: c.rewardClaimedAt,
					createdAt: c.createdAt,
					updatedAt: c.updatedAt,
				},
				tenantId,
			);
			result.childChallengesImported++;
		} catch (e) {
			result.childChallengesSkipped++;
			result.errors.push(
				`チャレンジ insert 失敗 (child=${c.childRef}, title=${c.title}): ${String(e)}`,
			);
		}
	}
}

/**
 * スタンプカード + 押印 entry を復元する (#3329)。
 * childRef で取込先 child に解決し insertCardForRestore で card (status/redeemed/日時) を復元、
 * 返却された新 cardId に各 entry を insertEntryForRestore で貼り直す (earnedAt 保全)。
 * entry の stampMasterId はグローバル master を指すため値のまま書き戻すが、対象環境に存在しない
 * 場合は FK で insert 失敗 → 当該 entry のみ skip+warning (card と他 entry は保全)。
 */
async function importStampCardsData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const repo = getRepos().stampCard;
	for (const card of data.data.stampCards ?? []) {
		const childId = childIdMap.get(card.childRef);
		if (!childId) {
			result.stampCardsSkipped++;
			continue;
		}
		let newCardId: number;
		try {
			const restored = await repo.insertCardForRestore(
				{
					childId,
					weekStart: card.weekStart,
					weekEnd: card.weekEnd,
					status: card.status,
					redeemedPoints: card.redeemedPoints,
					redeemedAt: card.redeemedAt,
					createdAt: card.createdAt,
					updatedAt: card.updatedAt,
				},
				tenantId,
			);
			newCardId = restored.id;
			result.stampCardsImported++;
		} catch (e) {
			result.stampCardsSkipped++;
			result.errors.push(
				`スタンプカード insert 失敗 (child=${card.childRef}, week=${card.weekStart}): ${String(e)}`,
			);
			continue;
		}
		for (const entry of card.entries) {
			try {
				await repo.insertEntryForRestore(
					{
						cardId: newCardId,
						stampMasterId: entry.stampMasterId,
						omikujiRank: entry.omikujiRank,
						slot: entry.slot,
						loginDate: entry.loginDate,
						earnedAt: entry.earnedAt,
					},
					tenantId,
				);
				result.stampEntriesImported++;
			} catch (e) {
				result.stampEntriesSkipped++;
				result.errors.push(
					`スタンプ押印 insert 失敗 (child=${card.childRef}, slot=${entry.slot}): ${String(e)}`,
				);
			}
		}
	}
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
		rewardRedemptionsImported: 0,
		rewardRedemptionsSkipped: 0,
		childChallengesImported: 0,
		childChallengesSkipped: 0,
		stampCardsImported: 0,
		stampCardsSkipped: 0,
		stampEntriesImported: 0,
		stampEntriesSkipped: 0,
		loginBonusesImported: 0,
		loginBonusesSkipped: 0,
		statusHistoryImported: 0,
		statusHistorySkipped: 0,
		evaluationsImported: 0,
		evaluationsSkipped: 0,
		checklistLogsImported: 0,
		checklistLogsSkipped: 0,
		settingsImported: 0,
		settingsSkipped: 0,
		staticFilesRestored: 0,
		staticFilesSkipped: 0,
		skipped: { preset: 0, name: 0, constraint: 0 },
		errors: [],
		warnings: [],
	};
}

/**
 * per-child 活動インスタンスを元の子へ復元する (#3327 P3)。
 *
 * 旧 `importActivityMaster` は `data.master.activities`（名前 flatten・dedup）を
 * `insertActivity`（first-child 一律 bind）で取り込んでいたため、(1) replace で子ゼロ時に throw、
 * (2) per-child binding 喪失 + 同名 dedup で全活動が縮約/喪失していた。本関数は `data.data.childActivities`
 * を `childIdMap` で元の子へ解決し `childActivity.insertActivity({childId,…})` で per-child 復元する。
 * 子は本関数より前に作成済（importFamilyData が children → 本関数の順）。
 */
async function importChildActivitiesData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const childActivities = data.data.childActivities ?? [];
	for (const a of childActivities) {
		const childId = childIdMap.get(a.childRef);
		if (!childId) {
			result.warnings.push(`活動「${a.name}」スキップ: childRef「${a.childRef}」が解決できません`);
			continue;
		}
		const categoryId = CATEGORY_CODE_TO_ID[a.categoryCode];
		if (!categoryId) {
			result.warnings.push(`活動「${a.name}」のカテゴリ「${a.categoryCode}」が不明のためスキップ`);
			continue;
		}
		try {
			await getRepos().childActivity.insertActivity(
				{
					childId,
					name: a.name,
					categoryId,
					icon: a.icon,
					basePoints: a.basePoints,
					triggerHint: a.triggerHint ?? null,
					isMainQuest: a.isMainQuest ?? 0,
					sourcePresetId: a.sourcePresetId ?? null,
					priority: a.priority === 'must' ? 'must' : 'optional',
				},
				tenantId,
			);
			result.activitiesCreated++;
		} catch (e) {
			result.warnings.push(`活動「${a.name}」(child=${a.childRef}) の作成に失敗: ${String(e)}`);
		}
	}
}

/**
 * 活動ログ remap 用の lookup を (childId, name) の 2 軸で構築する (#3327)。
 *
 * 旧 `buildActivityLookup` は `findActivities(tenantId)`（childId を持たない Activity shape）を
 * name キー 1 軸で Map 化していたため、兄弟が同名活動を持つと last-wins で 1 件に縮約し、
 * child1 のログが child2 の activity id に bind される cross-child 誤 bind を起こしていた
 * (ADR-0055 per-child 境界侵害)。本関数は childId ごとに `findActivitiesByChild` を引き、
 * childId → (name → activity) の入れ子 Map を返す。importActivityLogsData が解決済 childId と
 * activityName の両方で activity を引くことで、各子の正しい activity instance に bind される。
 */
async function buildActivityLookupByChild(
	childIdMap: Map<string, number>,
	tenantId: string,
): Promise<Map<number, Map<string, { id: number; name: string }>>> {
	const lookup = new Map<number, Map<string, { id: number; name: string }>>();
	const childActivityRepo = getRepos().childActivity;
	for (const childId of new Set(childIdMap.values())) {
		const activities = await childActivityRepo.findActivitiesByChild(childId, tenantId, {
			includeArchived: true,
		});
		const byName = new Map<string, { id: number; name: string }>();
		for (const a of activities) {
			byName.set(a.name, { id: a.id, name: a.name });
		}
		lookup.set(childId, byName);
	}
	return lookup;
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
	activityLookupByChild: Map<number, Map<string, { id: number; name: string }>>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const existingLogKeysByChild = new Map<number, Set<string>>();
	// #3327: 「見つからない」warning の dedup は (childId, name) で行う。name のみだと
	// 子 A で欠落・子 B で存在のケースで正当な warning を抑制してしまう。
	const missingActivityKeys = new Set<string>();

	for (const log of data.data.activityLogs) {
		const childId = childIdMap.get(log.childRef);
		if (!childId) continue;

		// #3327: 解決済 childId と activityName の 2 軸で activity を引く。これで兄弟同名活動が
		// 各子の正しい activity instance に bind され、cross-child 誤 bind を防ぐ (ADR-0055)。
		const activity = activityLookupByChild.get(childId)?.get(log.activityName);
		if (!activity) {
			result.activityLogsSkipped++;
			const missKey = `${childId}:${log.activityName}`;
			if (!missingActivityKeys.has(missKey)) {
				missingActivityKeys.add(missKey);
				result.warnings.push(
					`活動ログスキップ: 活動「${log.activityName}」(child=${log.childRef}) がマスタに見つかりません`,
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

/** checklistLog の再マップに使う、childId 単位の template id 解決マップ群。 */
export interface ChecklistTemplateIdMaps {
	/** templateName → templateId (#3078、旧 export の fallback 用) */
	byName: Map<number, Map<string, number>>;
	/** exportId → templateId (#3107、同名 template 取り違え防止の安定キー) */
	byExportId: Map<number, Map<string, number>>;
}

/** childId 単位の checklist template import 状態 (既存 + 当 import で作成した template の id 解決)。 */
interface ChildChecklistState {
	/**
	 * #3107: tenant に **取込前から存在した** template 名のスナップショット (DB load 時点)。
	 * re-import (同一 backup の再取込) の冪等性を担保する name-dedup はこの集合に対してのみ行う。
	 * 当 import 内で新規作成した同名 template (distinct exportId) はここに含めず、collapse させない。
	 */
	preExistingNames: Set<string>;
	/** preExisting + 当 import で作成した template 全ての名 (exportId なし旧 backup の fallback name-dedup 用)。 */
	names: Set<string>;
	presetIds: Set<string>;
	idByName: Map<string, number>;
	idByPreset: Map<string, number>;
	/** exportId → templateId (#3107 round-trip キー、当 import data の exportId のみ) */
	exportIdToId: Map<string, number>;
}

/** child の既存 template から import 状態を初期化する。 */
async function loadChildChecklistState(
	childId: number,
	tenantId: string,
): Promise<ChildChecklistState> {
	const rows = await findTemplatesByChild(childId, tenantId, true, true);
	const existingNames = new Set(rows.map((r) => r.name));
	return {
		preExistingNames: new Set(existingNames),
		names: existingNames,
		presetIds: new Set(rows.map((r) => r.sourcePresetId).filter((p): p is string => !!p)),
		idByName: new Map(rows.map((r) => [r.name, r.id])),
		idByPreset: new Map(
			rows.filter((r) => r.sourcePresetId).map((r) => [r.sourcePresetId as string, r.id]),
		),
		exportIdToId: new Map(),
	};
}

/** 1 件の checklist template を import (重複スキップ / 新規作成) し、exportId を id に登録する。 */
async function importOneChecklistTemplate(
	tpl: ExportData['data']['checklistTemplates'][number],
	childId: number,
	state: ChildChecklistState,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	// #3107: 解決先 templateId を round-trip キー (exportId) に登録する (スキップ時も既存 id を登録)。
	const register = (templateId: number) => {
		if (tpl.exportId) state.exportIdToId.set(tpl.exportId, templateId);
	};

	// #3107: 同一 import data 内に同じ exportId が 2 度現れたら真の重複 → 既存解決先を再登録して skip。
	//   (export-service は templateId ごとに distinct exportId を発番するため通常は発生しないが防御的に処理)
	if (tpl.exportId && state.exportIdToId.has(tpl.exportId)) {
		result.skipped.name++;
		return;
	}

	// #1254 G1: preset_duplicate → name_duplicate の順で判定
	if (tpl.sourcePresetId && state.presetIds.has(tpl.sourcePresetId)) {
		result.skipped.preset++;
		const dupId = state.idByPreset.get(tpl.sourcePresetId);
		if (dupId !== undefined) register(dupId);
		return;
	}
	// #3107: name-dedup の対象集合を exportId 有無で切り替える。
	//   - exportId あり (新 backup): 取込前から存在した template (preExistingNames) との衝突のみ skip。
	//     当 import 内で先に作成した同名 template (distinct exportId) には collapse させず、各々 distinct
	//     な template として復元する (同名 template の log 取り違え = #3107 根治)。re-import の冪等性は
	//     pre-existing 名一致で担保される (DB の既存行は exportId を持たないため name でしか照合できない)。
	//   - exportId なし (旧 backup): 従来通り full names (preExisting + 当 import 作成分) で name-dedup
	//     し後方互換を維持する。
	const nameDedupSet = tpl.exportId ? state.preExistingNames : state.names;
	if (nameDedupSet.has(tpl.name)) {
		result.skipped.name++;
		const dupId = state.idByName.get(tpl.name);
		if (dupId !== undefined) register(dupId);
		return;
	}

	try {
		// #2362 PR-5 (ADR-0055): family master template + assignment 自動付与。
		const newTpl = await insertTemplate(
			{
				name: tpl.name,
				icon: tpl.icon,
				pointsPerItem: tpl.pointsPerItem,
				completionBonus: tpl.completionBonus,
				isActive: tpl.isActive ? 1 : 0,
				sourcePresetId: tpl.sourcePresetId ?? null,
			},
			tenantId,
		);
		await assignTemplateToChildren(newTpl.id, [childId], tenantId);
		state.names.add(tpl.name);
		state.idByName.set(tpl.name, newTpl.id);
		register(newTpl.id);
		if (tpl.sourcePresetId) {
			state.presetIds.add(tpl.sourcePresetId);
			state.idByPreset.set(tpl.sourcePresetId, newTpl.id);
		}
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

/**
 * チェックリスト template を import する。
 *
 * 返り値 (#3078 / #3107): childId → templateName/exportId → templateId の解決マップ。
 *   既存 (重複スキップ含む) / 新規作成いずれの template も登録するため、後段の checklistLog
 *   import が `templateExportId` (優先) または `templateName` (fallback) から新 templateId を解決できる。
 *   #3107: 同名 template が複数あっても exportId 経由で正しい template に attach する。
 */
async function importChecklistTemplatesData(
	data: ExportData,
	childIdMap: Map<string, number>,
	tenantId: string,
	result: ImportResult,
): Promise<ChecklistTemplateIdMaps> {
	const stateByChild = new Map<number, ChildChecklistState>();

	for (const tpl of data.data.checklistTemplates) {
		const childId = childIdMap.get(tpl.childRef);
		if (!childId) continue;

		let state = stateByChild.get(childId);
		if (!state) {
			state = await loadChildChecklistState(childId, tenantId);
			stateByChild.set(childId, state);
		}
		await importOneChecklistTemplate(tpl, childId, state, tenantId, result);
	}

	const byName = new Map<number, Map<string, number>>();
	const byExportId = new Map<number, Map<string, number>>();
	for (const [childId, state] of stateByChild) {
		byName.set(childId, state.idByName);
		byExportId.set(childId, state.exportIdToId);
	}
	return { byName, byExportId };
}

/**
 * チェックリスト完了履歴 (checklistLogs) を import する (#3078 / #3107)。
 *
 * - #3107: `templateExportId` (安定キー) を優先して import 後の新 templateId に再マップし、
 *   無い場合 (旧 export) のみ `templateName` で fallback する。同名 template が複数あっても
 *   取り違えない。
 * - 重複は (childId, templateId, checkedDate) 既存ログとの照合で事前スキップする
 *   (upsertLog は UNIQUE 制約上書きのため、重複を import 件数に数えない)。
 * - template が解決できないログ (template 未取込) はスキップ。
 */
async function importChecklistLogsData(
	data: ExportData,
	childIdMap: Map<string, number>,
	templateIdMaps: ChecklistTemplateIdMaps,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const existingKeysByChild = new Map<number, Set<string>>();

	for (const log of data.data.checklistLogs) {
		const childId = childIdMap.get(log.childRef);
		if (!childId) {
			result.checklistLogsSkipped++;
			continue;
		}

		// #3107: exportId を優先解決、無ければ name で fallback (旧 export 互換)
		const templateId =
			(log.templateExportId
				? templateIdMaps.byExportId.get(childId)?.get(log.templateExportId)
				: undefined) ?? templateIdMaps.byName.get(childId)?.get(log.templateName);
		if (!templateId) {
			result.checklistLogsSkipped++;
			continue;
		}

		let existingKeys = existingKeysByChild.get(childId);
		if (!existingKeys) {
			const rows = await findLogsByChild(childId, tenantId);
			existingKeys = new Set(rows.map((r) => `${r.templateId}:${r.checkedDate}`));
			existingKeysByChild.set(childId, existingKeys);
		}

		const key = `${templateId}:${log.checkedDate}`;
		if (existingKeys.has(key)) {
			result.checklistLogsSkipped++;
			result.skipped.constraint++;
			continue;
		}

		try {
			await upsertLog(
				{
					childId,
					templateId,
					checkedDate: log.checkedDate,
					itemsJson: log.itemsJson,
					completedAll: log.completedAll ? 1 : 0,
					pointsAwarded: log.pointsAwarded,
				},
				tenantId,
			);
			result.checklistLogsImported++;
			existingKeys.add(key);
		} catch (e) {
			result.checklistLogsSkipped++;
			result.errors.push(
				`チェックリスト履歴 insert 失敗 (child=${log.childRef}, template=${log.templateName}): ${String(e)}`,
			);
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
	const existingByChild = new Map<number, { titles: Set<string>; presetIds: Set<string> }>();
	for (const sr of data.data.specialRewards) {
		const childId = childIdMap.get(sr.childRef);
		if (!childId) continue;

		let existing = existingByChild.get(childId);
		if (!existing) {
			const rows = await findSpecialRewards(childId, tenantId);
			existing = {
				titles: new Set(rows.map((r) => r.title)),
				presetIds: new Set(rows.map((r) => r.sourcePresetId).filter((p): p is string => !!p)),
			};
			existingByChild.set(childId, existing);
		}

		// #1254 G1: preset_duplicate → name_duplicate の順で判定
		if (sr.sourcePresetId && existing.presetIds.has(sr.sourcePresetId)) {
			result.specialRewardsSkipped++;
			result.skipped.preset++;
			continue;
		}
		if (existing.titles.has(sr.title)) {
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
					sourcePresetId: sr.sourcePresetId ?? null,
				},
				tenantId,
			);
			result.specialRewardsImported++;
			existing.titles.add(sr.title);
			if (sr.sourcePresetId) existing.presetIds.add(sr.sourcePresetId);
		} catch (e) {
			errors.push(`ごほうび「${sr.title}」のインポートに失敗: ${String(e)}`);
		}
	}
	if (result.specialRewardsSkipped > 0) {
		warnings.push(
			`ごほうび ${result.specialRewardsSkipped} 件が既存と同名または同一プリセットのためスキップされました`,
		);
	}
}

// ============================================================
// 静的ファイル (アバター画像 / 音声) の復元 (#3077)
// ============================================================

/** 静的ファイル ZIP 相対パスの形式: `<type>/<childId>/<rest...>` (type = avatars|voices|generated) */
const STATIC_FILE_PATH_RE = /^(avatars|voices|generated)\/(\d+)\/(.+)$/;

/**
 * ZIP 相対パスに path-escape (`..` や絶対パス) が含まれていないか検証する (zip-slip 防御)。
 * `STATIC_FILE_PATH_RE` の `rest` (`.+`) は任意文字を許すため、ここで `..` セグメント・
 * 先頭スラッシュ・Windows ドライブ等を弾く。安全なら true。
 */
function isSafeRelativePath(relPath: string): boolean {
	// バックスラッシュは OS 非依存で無条件拒否する (Linux では `\` がファイル名のリテラル
	// 文字になり segment 分割では escape を検知できないため、含むパスはすべて弾く)。
	if (relPath.includes('\\')) return false;
	if (relPath.startsWith('/')) return false; // 絶対パス
	if (/^[a-zA-Z]:/.test(relPath)) return false; // Windows ドライブレター
	const segments = relPath.split('/');
	for (const seg of segments) {
		if (seg === '..') return false; // 親ディレクトリ参照
	}
	return true;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	webm: 'audio/webm',
};

function contentTypeFromPath(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * ZIP 同梱の静的ファイル (`avatars/<oldChildId>/…` / `voices/<oldChildId>/…`) を
 * import 後の新 childId 配下に再配置し、child.avatarUrl 参照を貼り替える (#3077)。
 *
 * - エクスポート元の `sourceChildId` → 新 childId の対応を解決し、パスの childId
 *   セグメントを書き換えて `tenants/<tenantId>/<type>/<newChildId>/<rest>` に保存する。
 * - 旧→新の storage key 対応を集め、各 child の avatarUrl を新 key (公開 URL) へ更新する。
 * - childId が解決できないファイル (孤立) はスキップする。
 */
async function importStaticFiles(
	data: ExportData,
	childIdMap: Map<string, number>,
	staticFiles: Record<string, Uint8Array>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	// sourceChildId (export 元の数値 id) → 新 childId
	const oldChildToNew = new Map<number, number>();
	for (const child of data.family.children) {
		const newId = childIdMap.get(child.exportId);
		if (typeof child.sourceChildId === 'number' && newId) {
			oldChildToNew.set(child.sourceChildId, newId);
		}
	}

	const prefix = tenantPrefix(tenantId);
	// 旧 storage key (相対パス) → 新 storage key (相対パス) の対応 (avatarUrl 貼り替え用)
	const relativeKeyRemap = new Map<string, string>();

	for (const [relPath, bytes] of Object.entries(staticFiles)) {
		// zip-slip 防御: `..` / 絶対パス等を含むエントリは保存せずスキップ扱いにする。
		if (!isSafeRelativePath(relPath)) {
			result.staticFilesSkipped++;
			continue;
		}
		const match = STATIC_FILE_PATH_RE.exec(relPath);
		if (!match) {
			// data.json や想定外パスはスキップ (data.json は API 側で除外済だが二重防御)
			continue;
		}
		const [, type, oldChildIdStr, rest] = match;
		const newChildId = oldChildToNew.get(Number(oldChildIdStr));
		if (!newChildId) {
			result.staticFilesSkipped++;
			continue;
		}

		const newRelPath = `${type}/${newChildId}/${rest}`;
		const storageKey = `${prefix}${newRelPath}`;
		try {
			await saveFile(storageKey, Buffer.from(bytes), contentTypeFromPath(relPath));
			relativeKeyRemap.set(relPath, newRelPath);
			result.staticFilesRestored++;
		} catch (e) {
			result.staticFilesSkipped++;
			result.errors.push(`静的ファイル「${relPath}」の復元に失敗: ${String(e)}`);
		}
	}

	await remapChildAvatarUrls(
		{ data, childIdMap, oldChildToNew, relativeKeyRemap },
		tenantId,
		result,
	);
}

export interface AvatarRemapState {
	data: ExportData;
	childIdMap: Map<string, number>;
	/** sourceChildId (export 元 id) → 新 childId */
	oldChildToNew: Map<number, number>;
	/** 旧 storage 相対パス → 復元済の新相対パス */
	relativeKeyRemap: Map<string, string>;
}

/**
 * 各 child の avatarUrl を import 後の新 storage key (公開 URL) に貼り替える (#3077)。
 *
 * avatarUrl は `/tenants/<oldTenant>/avatars/<oldChildId>/<uuid>.<ext>` 形式。
 * tenant / childId セグメントを新環境のものに書き換え、復元済ファイルがあれば参照を更新する。
 */
export async function remapChildAvatarUrls(
	state: AvatarRemapState,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const { data, childIdMap, oldChildToNew, relativeKeyRemap } = state;
	const prefix = tenantPrefix(tenantId);

	/** avatarUrl 更新を 1 箇所に集約し、失敗は result.errors に蓄積する。 */
	const persist = async (childId: number, url: string | null, exportId: string): Promise<void> => {
		try {
			await updateChildAvatarUrl(childId, url, tenantId);
		} catch (e) {
			result.errors.push(`アバター参照の更新に失敗 (child=${exportId}): ${String(e)}`);
		}
	};

	for (const child of data.family.children) {
		if (!child.avatarUrl) continue;
		const newChildId = childIdMap.get(child.exportId);
		if (!newChildId) continue;

		// `/tenants/<tenant>/<type>/<childId>/<rest>` から相対パス `<type>/<childId>/<rest>` を抽出。
		const avatarMatch = /\/tenants\/[^/]+\/(avatars\/\d+\/.+)$/.exec(child.avatarUrl);
		const oldRelPath = avatarMatch?.[1];
		if (!oldRelPath) continue;

		const newRelPath = resolveNewAvatarRelPath(oldRelPath, {
			relativeKeyRemap,
			oldChildToNew,
			newChildId,
		});
		if (newRelPath === undefined) continue; // 抽出不能 → 据え置き (skip)
		if (newRelPath === null) {
			// zip-slip 防御で unsafe と判定 → dangling→null と同じく null 化する。
			await persist(newChildId, null, child.exportId);
			continue;
		}

		// #3136: 実ファイルが復元されている場合のみ avatarUrl を貼り替える。ZIP に静的ファイルが
		// 同梱されていない (JSON のみ移管) / 改竄破損で skip された場合に、存在しない storage key を
		// 指す dangling avatarUrl を生成しないため、貼替前に fileExists で実在を検証する。実在しなければ
		// avatarUrl を null 化する (旧 tenant path を据え置くと、それ自体が新環境で dangling になるため)。
		const newKey = `${prefix}${newRelPath}`;
		try {
			const restored = await fileExists(newKey);
			await persist(newChildId, restored ? storageKeyToPublicUrl(newKey) : null, child.exportId);
		} catch (e) {
			result.errors.push(`アバター参照の更新に失敗 (child=${child.exportId}): ${String(e)}`);
		}
	}
}

/**
 * 旧相対パスから貼替先の新相対パスを解決する (#3136 / zip-slip 防御)。
 *
 * - 同梱ファイル復元済 (`relativeKeyRemap` hit) を優先。これらは importStaticFiles 保存時に
 *   `isSafeRelativePath` で検証済 (§importStaticFiles) のため再検証不要。
 * - miss 時は backup 由来 avatarUrl から id セグメントを書き換えて再構成する。backup の avatarUrl は
 *   `STATIC_FILE_PATH_RE` の `(.+)$` に `..` / 絶対パスを含み得るため、再構成 key に
 *   `isSafeRelativePath` を適用する (importStaticFiles と同じ zip-slip ガード)。
 *
 * @returns 新相対パス / `undefined` (抽出不能 = skip) / `null` (unsafe = avatarUrl を null 化)
 */
function resolveNewAvatarRelPath(
	oldRelPath: string,
	ctx: {
		relativeKeyRemap: Map<string, string>;
		oldChildToNew: Map<number, number>;
		newChildId: number;
	},
): string | null | undefined {
	const hit = ctx.relativeKeyRemap.get(oldRelPath);
	if (hit) return hit;

	const relMatch = STATIC_FILE_PATH_RE.exec(oldRelPath);
	const type = relMatch?.[1];
	const oldChildIdStr = relMatch?.[2];
	const rest = relMatch?.[3];
	if (!type || !oldChildIdStr || !rest) return undefined;

	const mappedChildId = ctx.oldChildToNew.get(Number(oldChildIdStr)) ?? ctx.newChildId;
	const candidate = `${type}/${mappedChildId}/${rest}`;
	// unsafe (`..` / 絶対パス) は fileExists で probe (存在オラクル化) / 永続化させない。
	if (!isSafeRelativePath(candidate)) return null;
	return candidate;
}

// Re-export labels type for API handler
export { IMPORT_LABELS };
