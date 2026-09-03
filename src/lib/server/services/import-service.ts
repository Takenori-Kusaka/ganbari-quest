import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
import { asCategoryId } from '$lib/domain/ids';

// src/lib/server/services/import-service.ts
// 家族データインポートサービス（Phase 2 / #1254）

import { sanitizeActivitySource } from '$lib/domain/activity-source';
import { toLegacyCategoryId } from '$lib/domain/categories';
import { sanitizeChecklistOverrideRestore } from '$lib/domain/checklist-override';
import {
	EXPORT_FORMAT,
	type ExportData,
	isExportableSettingKey,
	isValidSettingValue,
} from '$lib/domain/export-format';
import { MIGRATABLE_VERSIONS, migrateExportData } from '$lib/domain/export-migrations';
import { IMPORT_LABELS, type ImportSkipReason } from '$lib/domain/labels';
import { sanitizeActivityNameField, sanitizeDailyLimit } from '$lib/domain/validation/activity';
import { isLegacyCompatibleDateTime } from '$lib/domain/validation/datetime';
import { MESSAGE_TEXT_MAX_LENGTH, MESSAGE_TYPES } from '$lib/domain/validation/message';
import { normalizeRedemptionQuantity } from '$lib/domain/validation/special-reward';
import type { ImportBlocked } from '$lib/marketplace/types';
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
	insertOverrideForRestore,
	insertTemplate,
	insertTemplateItem,
	upsertLog,
} from '$lib/server/db/checklist-repo';
import { insertChild } from '$lib/server/db/child-repo';
import { findEvaluationsByChild, insertEvaluation } from '$lib/server/db/evaluation-repo';
import { getRepos } from '$lib/server/db/factory';
import { updateChildAvatarUrl } from '$lib/server/db/image-repo';
import { upsertStreak } from '$lib/server/db/login-bonus-repo';
import { insertRedemptionForRestore } from '$lib/server/db/reward-redemption-repo';
import { setSetting } from '$lib/server/db/settings-repo';
import { findSpecialRewards, insertSpecialReward } from '$lib/server/db/special-reward-repo';
import { insertStatusHistory, upsertStatus } from '$lib/server/db/status-repo';
import type { InsertChildActivityInput } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';
import { fileExists, saveFile } from '$lib/server/storage';
import { storageKeyToPublicUrl, tenantPrefix } from '$lib/server/storage-keys';

/** categoryCode (未検証文字列) → branded CategoryId (#3607: SSOT 派生、旧 index-based map を撤去) */
function categoryIdFromCode(code: string): CategoryId | undefined {
	const legacyId = toLegacyCategoryId(code);
	return legacyId === undefined ? undefined : asCategoryId(legacyId);
}

/**
 * #3692: import insert の並列チャンク実行度。
 *
 * 本番 restore が Lambda 30s timeout (504) した根因は、実バックアップ ≈ 1,200 行を
 * 1 insert = 最大 3 DynamoDB 往復 (採番 + denormalize read + Put) で逐次 await して
 * いたこと (≈ 3,000 往復 × 10-20ms = 30-60s)。件数支配ヘルパは runConcurrent で
 * 並列化し、往復の壁時計時間を 1/CONCURRENCY に圧縮する。
 *
 * 値の根拠: DynamoDB on-demand は並列 25 程度で throttle しない (BatchWriteItem の
 * 上限 25 と同水準)。PGlite (NUC) は単一接続で内部 queue されるため並列発行しても
 * 安全、better-sqlite3 は同期実行で実質逐次 — いずれの backend でも正しさに影響しない。
 */
const IMPORT_INSERT_CONCURRENCY = 25;

/**
 * items を最大 concurrency 本の worker で並列処理する (#3692)。
 *
 * worker 内でエラーを catch して result.errors に積む既存 import ヘルパの規約を
 * 前提とする (worker が reject すると全体が reject する — 呼び出し側で try/catch 必須)。
 * dedup 判定 (Set 参照/更新) は並列区間に入れると race するため、呼び出し側は
 * 「同期 phase で dedup と insert 対象を確定 → 本関数で insert のみ並列実行」の
 * 2-phase に分ける。
 */
async function runConcurrent<T>(
	items: readonly T[],
	worker: (item: T) => Promise<void>,
	concurrency = IMPORT_INSERT_CONCURRENCY,
): Promise<void> {
	let next = 0;
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (next < items.length) {
			const item = items[next++];
			// noUncheckedIndexedAccess: next < length で取得するため実際には undefined にならない
			if (item === undefined) continue;
			await worker(item);
		}
	});
	await Promise.all(runners);
}

/**
 * content dedup (#3414/#3420) 用の既存行 prefetch 上限。
 * parentMessage は findMessages(childId, limit) 契約のため十分大きな値で全件相当を取る
 * (export 側 MAX_EXPORT_ROWS と同水準の桁。家庭内データで到達しない安全上限)。
 */
const RESTORE_DEDUP_FETCH_LIMIT = 100_000;

/**
 * 日時 (ISO 8601 または SQL datetime、`Date.parse` 可) か。restore / cutover の verbatim
 * 値検証用 (#3414/#3420)。
 *
 * #3851: SQLite `CURRENT_TIMESTAMP` 既定値 (スペース区切り) を持つ正当な legacy 行が
 * `T` 必須 regex で silent drop → 件数突合 abort する false-positive data-loss を是正した。
 * #3859: 形式定数を $lib/domain/validation/datetime に SSOT 集約し、settings validator
 * (export-format) と同一述語を import する (片側だけ `T` 必須が残る同 class ドリフトの根絶)。
 */
const isValidIsoDateTime = isLegacyCompatibleDateTime;

/** bonusPoints の許容範囲 (null または 0〜99,999 の整数)。改竄 backup の範囲外値を弾く (#3414)。 */
function isValidBonusPoints(value: number | null): boolean {
	return value === null || (Number.isInteger(value) && value >= 0 && value <= 99_999);
}

/**
 * export data の取込対象行数の概算 (#3692 observability)。
 * import 開始ログに載せ、Lambda 30s 制約下で「何行の取込にどれだけかかったか」を
 * CloudWatch で切り分け可能にする (本番 restore 504 は経路無ログで切り分け不能だった)。
 */
export function countImportRows(data: ExportData): number {
	const d = data.data;
	return Object.values(d)
		.filter((v): v is unknown[] => Array.isArray(v))
		.reduce((sum, rows) => sum + rows.length, 0);
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
	/** #3329: per-child 証明書の取込件数 */
	certificatesImported: number;
	certificatesSkipped: number;
	/** #3329: 親→子おうえんメッセージの取込件数 */
	parentMessagesImported: number;
	parentMessagesSkipped: number;
	/** #3329: きょうだい間おうえんスタンプの取込件数 */
	/** #3329: per-child 活動設定 (ピン留め) の取込件数 */
	activityPrefsImported: number;
	activityPrefsSkipped: number;
	/** #3329: per-child チェックリスト日次 override の取込件数 */
	checklistOverridesImported: number;
	checklistOverridesSkipped: number;
	/** #3329: per-child おやすみ日の取込件数 (DynamoDB では no-op で skip) */
	/** #3329: 子のカスタム音声 DB 行の取込件数 (ファイル本体は #3077 が復元) */
	childVoicesImported: number;
	childVoicesSkipped: number;
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
	/**
	 * #4693 (QM #4784): プラン上限で **意図的に復元対象から外した** 活動行数と、その顧客向け理由。
	 * `warnings` (内部ログ寄り) とは別に、画面が理由 + アップグレード導線を出すための channel。
	 */
	blocked?: ImportBlocked;
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
	// 対応バージョンの SSOT は export-migrations の MIGRATABLE_VERSIONS 単独 (版一覧の二重列挙を廃止)。
	// 未知の未来版は hard-fail (pg_dump 精神)。旧版は importFamilyData 入口の migrateExportData が
	// 現 shape に copy-transform する (Layer2 = 版識別 + 旧 shape 読取を export-migrations が単一所有)。
	if (!MIGRATABLE_VERSIONS.includes(d.version as string)) {
		return {
			valid: false,
			error: `バージョンが不正です（対応: ${MIGRATABLE_VERSIONS.join(', ')}, 実際: ${d.version}）`,
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
	// #3521: preview も importFamilyData と同じ lazy migration seam を通す。現状の STEPS は全て
	// identity のため件数は不変だが、将来 breaking transform (フィールド rename / 分割 / 件数変化を
	// 伴う正規化) を導入した際に、置換確認ダイアログで見せる件数プレビューと importFamilyData で
	// migrate 後に実取込される件数が食い違うのを構造的に防ぐ (実 transform 導入前に seam を揃えておく)。
	// checksum 検証は呼び出し側 (route) で本処理の前に済んでいる (version 書換は checksum 後に行う)。
	data = migrateExportData(
		data as unknown as Record<string, unknown>,
		data.version,
	) as unknown as ExportData;

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

	// NOTE: activityLogs の重複検出には子供単位の pre-fetch が必要だが、
	//       preview 段階では child_id が確定していない (新規作成前)。
	//       実インポート時は importFamilyData 側で正確に判定する。

	return {
		children: data.family.children.length,
		activityLogs: data.data.activityLogs.length,
		pointLedger: data.data.pointLedger.length,
		statuses: data.data.statuses.length,
		achievements: data.data.childAchievements.length,
		titles: data.data.childTitles.length,
		loginBonuses: data.data.loginStreaks.length,
		checklistTemplates: data.data.checklistTemplates.length,
		specialRewards: data.data.specialRewards.length,
		duplicates,
	};
}

/**
 * import の重複解決 semantics (#3653)。
 *
 * - `merge` (既定、現行挙動): 既存 DB / 同一 import 内の同名・同 preset・同時刻行を dedup skip する。
 *   バックアップの再取込・marketplace 二重取込の防止が目的 (merge import)。
 * - `verbatim`: dedup を bypass し全行を復元する。cutover (fresh DB への完全移行、#3620) 用 —
 *   実本番 DB には同 child 同 title の specialRewards 等が正当に存在し (NUC staging cycle 3 で
 *   件数突合が export=9 → imported=2 の欠落を実検出)、merge semantics では移行にならない。
 *   childRef / FK 解決不能・allowlist・path 検証などの整合性 skip は mode に関わらず維持する。
 */
export type ImportMode = 'merge' | 'verbatim';

export interface ImportOptions {
	/**
	 * #4693 (QM #4784): 活動の復元にプラン上限 (`enforceActivityQuota`) を掛けるか。
	 * 既定は `mode` で決まる: `merge` (HTTP の復元 / クラウド取込) = 掛ける、
	 * `verbatim` (NUC cutover / staging seed = 自環境への完全移行) = 掛けない。
	 * verbatim 側では activity-quota を読み込まない (静的 import だと `$app` 依存が tsx の CLI で解決できない)。
	 */
	enforceQuota?: boolean;
	mode?: ImportMode;
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
 * @param options #3653: mode='verbatim' で dedup を bypass (cutover 用)。既定 merge = 現行不変。
 */
export async function importFamilyData(
	data: ExportData,
	tenantId: string,
	staticFiles?: Record<string, Uint8Array>,
	options?: ImportOptions,
): Promise<ImportResult> {
	const mode: ImportMode = options?.mode ?? 'merge';
	const enforceQuota = options?.enforceQuota ?? mode === 'merge';
	// #3326 系: lazy マイグレーション。旧 version の backup を現 shape に正規化してから取り込む。
	// checksum 検証は呼び出し側 (route) で本処理の前に済んでいる (version 書換は checksum 後でなければ mismatch する)。
	data = migrateExportData(
		data as unknown as Record<string, unknown>,
		data.version,
	) as unknown as ExportData;

	const result = createEmptyImportResult();
	logger.info('[import] インポート開始', { context: { tenantId, version: data.version } });

	// #3327 P3: 子を先に作成し childIdMap を確定してから per-child 活動を復元する
	// (旧実装は活動を子より先に import → replace で子ゼロ時に insertActivity が throw → 全活動喪失)。
	const childIdMap = await importChildrenData(data, tenantId, result);

	if (childIdMap.size === 0) {
		result.errors.push('子供の作成が全て失敗しました');
		return result;
	}

	// #3327 P3: per-child 活動を元の子へ復元 (master flatten の first-child 一律 bind を廃止)。
	await importChildActivitiesData(data, childIdMap, tenantId, result, enforceQuota);
	// #3327: 活動ログ remap 用の lookup は (childId, name) の 2 軸で構築する。name のみ lookup は
	// 兄弟同名活動を 1 件に縮約 (last-wins) し child1 のログを child2 の activity に bind する
	// cross-child 誤 bind を生む (ADR-0055 per-child 境界侵害)。per-child 活動 insert 後に構築する。
	const activityLookupByChild = await buildActivityLookupByChild(childIdMap, tenantId);

	await importStatusesData(data, childIdMap, tenantId, result);
	await importActivityLogsData(data, childIdMap, activityLookupByChild, tenantId, result, mode);
	// #3329: per-child 活動設定 (ピン留め)。activityName を取込先 childActivity に再解決して復元。
	// 活動 lookup (name→新 id) が必要なので buildActivityLookupByChild の後に実行する。
	await importActivityPrefsData(data, childIdMap, activityLookupByChild, tenantId, result);
	await importPointLedgerData(data, childIdMap, tenantId, result);
	await importLoginStreaksData(data, childIdMap, tenantId, result);
	const templateIdMap = await importChecklistTemplatesData(
		data,
		childIdMap,
		tenantId,
		result,
		mode,
	);
	await importChecklistLogsData(data, childIdMap, templateIdMap, tenantId, result);
	// #3329: チェックリスト日次 override を createdAt 保全で復元。childIdMap のみ必要。
	await importChecklistOverridesData(data, childIdMap, tenantId, result);
	// #3329: おやすみ日を createdAt 保全で復元。childIdMap のみ必要 (DynamoDB では insert が no-op)。
	// #3329: 子のカスタム音声 DB 行を復元 (filePath/publicUrl を新 tenant+childId へ remap)。childIdMap のみ必要。
	// #3781: DB 行↔ファイル本体の dangling 相互整合を fail-closed 検証するため staticFiles を渡す。
	await importChildVoicesData(data, childIdMap, tenantId, result, staticFiles);
	// #3381: importSpecialRewards が返す exportId → 新 rewardId マップを交換履歴の安定再結合に使う。
	const rewardIdByExportId = await importSpecialRewards(data, childIdMap, tenantId, result, mode);
	// #3329: ごほうび交換/購入履歴。reward を先に取込済なので importSpecialRewards の後に実行する。
	// #3381: rewardExportId (安定識別子) 優先 → rewardRef (title) fallback で再結合する。
	await importRewardRedemptionsData(data, childIdMap, rewardIdByExportId, tenantId, result);
	// #3329: per-child チャレンジ (auto:weekly 含む) を進捗/完了/請求保全で復元。childIdMap のみ必要。
	await importChildChallengesData(data, childIdMap, tenantId, result);
	// #3329: スタンプカード + 押印。card を復元 → 新 cardId に entry を貼り直す。childIdMap のみ必要。
	await importStampCardsData(data, childIdMap, tenantId, result);
	// #3329: 証明書 (がんばり/卒業証明書 授与記録) を issuedAt 保全で復元。childIdMap のみ必要。
	await importCertificatesData(data, childIdMap, tenantId, result);
	// #3329: 親→子おうえんメッセージを sentAt/shownAt 保全で復元。childIdMap のみ必要。
	// #3414: merge mode は content dedup で再取込冪等 (verbatim = cutover は bypass)。
	await importParentMessagesData(data, childIdMap, tenantId, result, mode);
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
/** 評価 dedup の既存行 prefetch 上限 (週次 = 年 52 行程度、10 年でも十分な余裕)。 */
const EVALUATION_DEDUP_PREFETCH = 100_000;

async function importEvaluationsData(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const evaluations = data.data.evaluations ?? [];
	if (evaluations.length === 0) return;

	// #3355: (childId, weekStart) は週次評価の自然キー (1 週 1 評価)。他 importer
	// (importActivityLogsData) と同型の pre-fetch dedup で、同一 backup の
	// 再取込 (merge) や重複行を二重計上しない (旧実装は無条件 insert で growth-book/reports の数値汚染)。
	// 既存 DB 行 + 同一 import 内の両方を dedup 対象にする (mode 非依存 = 自然キーは
	// verbatim でも重複が正当化されないため常に dedup)。
	const existingWeeksByChild = new Map<ChildId, Set<string>>();
	async function existingWeeks(childId: ChildId): Promise<Set<string>> {
		let set = existingWeeksByChild.get(childId);
		if (!set) {
			const rows = await findEvaluationsByChild(childId, EVALUATION_DEDUP_PREFETCH, tenantId);
			set = new Set(rows.map((e) => e.weekStart));
			existingWeeksByChild.set(childId, set);
		}
		return set;
	}

	for (const ev of evaluations) {
		const childId = childIdMap.get(ev.childRef);
		if (!childId) {
			result.evaluationsSkipped++;
			continue;
		}
		const weeks = await existingWeeks(childId);
		if (weeks.has(ev.weekStart)) {
			// 既存 or 同一 import 内の同 (child, weekStart) → skip (二重計上防止)。
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
					// #3355: 作成日時を保全 (取込時刻に書き換えると growth-book/reports の時系列が歪む)。
					createdAt: ev.createdAt,
				},
				tenantId,
			);
			weeks.add(ev.weekStart);
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
 * ごほうびショップ交換/購入履歴を復元する (#3329 / #3381)。
 * FK rewardId は import で振り直されるため再結合が必要。
 * #3381: 安定識別子 `rewardExportId` (importSpecialRewards が返す exportId→新 rewardId マップ) を
 * 優先キーに再結合し、無い場合 (旧 backup) のみ `rewardRef` (snapshot title) で取込先 child の reward
 * 一覧から fallback 解決する。これにより reward が redemption 後に改名されても / 同名 reward が複数あっても
 * 交換履歴が silent skip / collapse しない (旧実装は live title 照合のみで改名後 skip していた)。
 * reward が解決できない行 (元 reward 未取込) は skip + warning (FK NOT NULL を満たせないため。残高への
 * 影響は別途 pointLedger が真実を持つ)。status / 解決情報 / snapshot は insertRedemptionForRestore で
 * 申請時点のまま書き戻す。
 */
async function importRewardRedemptionsData(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	rewardIdByExportId: Map<ChildId, Map<string, string>>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const redemptions = data.data.rewardRedemptions ?? [];
	if (redemptions.length === 0) return;

	// 取込先 child ごとに reward title → rewardId の lookup を構築する (新規 insert + 既存 dedup 双方を含む)。
	const rewardIdByChildTitle = new Map<ChildId, Map<string, string>>();
	async function rewardLookup(childId: ChildId): Promise<Map<string, string>> {
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
		// #3381: 安定識別子 (rewardExportId) を優先、無ければ snapshot title で fallback 解決。
		const rewardId =
			(r.rewardExportId ? rewardIdByExportId.get(childId)?.get(r.rewardExportId) : undefined) ??
			(await rewardLookup(childId)).get(r.rewardRef) ??
			// #4683: 元テナントで削除済のごほうびは backup の specialRewards に含まれず解決できない。
			// それでも履歴は復元する — ポイント台帳の控除は復元されるため、履歴だけ落とすと
			// 「使途の分からない減算」が残る (削除時に履歴を残す本 Issue の決定と同じ理由)。
			// null を渡すと repo が「採番されない id」を書き、表示は snapshot 列が担う。
			null;
		if (rewardId === null) {
			result.warnings.push(
				`交換履歴「${r.rewardTitle ?? r.rewardRef}」(child=${r.childRef}) は取込先にごほうびが無いため、記録だけ復元しました`,
			);
		}
		try {
			const restored = await insertRedemptionForRestore(
				{
					childId,
					rewardId,
					requestedAt: r.requestedAt,
					// #4407: 旧 backup (v1.8.0 以前) には quantity が無いため 1 個として復元する。
					quantity: normalizeRedemptionQuantity(r.quantity),
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
			// #3394: null = 永続化なし (demo no-op stub)。imported に加算しない (#2263 count 偽装防止)。
			if (restored) result.rewardRedemptionsImported++;
			else result.rewardRedemptionsSkipped++;
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
		// #3382: allowlist キーでも値域/型/enum を検証してから書き戻す (改竄/破損 backup の
		// 範囲外 decay_intensity・非数値 point_rate・未知 enum・制御文字混入を fail-closed で弾く)。
		if (typeof s.value !== 'string' || !isValidSettingValue(s.key, s.value)) {
			result.settingsSkipped++;
			result.warnings.push(`設定「${s.key}」の値が不正なためスキップしました`);
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
	childIdMap: Map<string, ChildId>,
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
			const restored = await getRepos().childChallenge.insertForRestore(
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
					// #4410: 祝福の「見せた」記録は端末横断の一時 UI 状態であり backup wire schema
					// (ADR-0066 値域 SSOT) には載せない。復元直後は未表示として扱い、達成済で未受取
					// なら祝福を 1 回だけ出す (以降は celebration_shown_at が停止条件になる)。
					celebrationShownAt: null,
					createdAt: c.createdAt,
					updatedAt: c.updatedAt,
				},
				tenantId,
			);
			// #3387/#3394 統一冪等契約: null = 重複 (auto:weekly 同週既存) skip。imported に加算しない
			// (count 偽装防止)。demo backend の書込 no-op も null で skip 計上される。
			if (restored) {
				result.childChallengesImported++;
			} else {
				result.childChallengesSkipped++;
				result.skipped.constraint++;
				result.warnings.push(
					`チャレンジ重複スキップ (child=${c.childRef}, title=${c.title}, week=${c.startDate})`,
				);
			}
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
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const repo = getRepos().stampCard;
	// #3692 phase 1 (同期): childId 解決。card → entries は親子依存のため card 単位を
	// worker とし、card insert → 当該 card の entries 並列 insert を worker 内で行う
	// (card 間は独立なので card レベルで並列化できる)。
	const tasks: { childId: ChildId; card: NonNullable<ExportData['data']['stampCards']>[number] }[] =
		[];
	for (const card of data.data.stampCards ?? []) {
		const childId = childIdMap.get(card.childRef);
		if (!childId) {
			result.stampCardsSkipped++;
			continue;
		}
		tasks.push({ childId, card });
	}
	// #3692 phase 2: card 単位で並列チャンク実行
	await runConcurrent(tasks, async ({ childId, card }) => {
		let newCardId: string;
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
			// #3391/#3394 統一冪等契約: null = 同 (child, weekStart) 重複 skip。card が skip されたら
			// 配下 entry も貼り先が無いため全件 skip 計上する (入力件数 = imported + skipped 恒等式)。
			if (!restored) {
				result.stampCardsSkipped++;
				result.skipped.constraint++;
				result.stampEntriesSkipped += card.entries.length;
				result.warnings.push(
					`スタンプカード重複スキップ (child=${card.childRef}, week=${card.weekStart})`,
				);
				return;
			}
			newCardId = restored.id;
			result.stampCardsImported++;
		} catch (e) {
			result.stampCardsSkipped++;
			result.stampEntriesSkipped += card.entries.length;
			result.errors.push(
				`スタンプカード insert 失敗 (child=${card.childRef}, week=${card.weekStart}): ${String(e)}`,
			);
			return;
		}
		await runConcurrent(card.entries, async (entry) => {
			try {
				const inserted = await repo.insertEntryForRestore(
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
				// #3394: 実 insert (true) のときのみ imported++。重複 ((cardId,slot) or (cardId,loginDate))
				// skip は false → skipped 計上 (旧実装は void 返却で常に imported++ される count 偽装だった)。
				if (inserted) {
					result.stampEntriesImported++;
				} else {
					result.stampEntriesSkipped++;
					result.skipped.constraint++;
				}
			} catch (e) {
				result.stampEntriesSkipped++;
				result.errors.push(
					`スタンプ押印 insert 失敗 (child=${card.childRef}, slot=${entry.slot}): ${String(e)}`,
				);
			}
		});
	});
}

/**
 * 証明書 (がんばり/卒業証明書 授与記録) を復元する (#3329)。
 * childRef で取込先 child に解決し insertForRestore で issuedAt / metadata を保全して書き戻す。
 * tenantId は復元先のものを使う (証明書は per-child の授与記録、id/tenantId は env 固有)。
 * 同 child + certificateType の重複は onConflictDoNothing で skip (null 返却 → skip カウント)。
 */
async function importCertificatesData(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const certs = data.data.certificates ?? [];
	if (certs.length === 0) return;

	// #3394 service 層 dedup (defense in depth): (childId, certificateType) の既存 + 同一 import 内
	// 重複を DB 到達前に skip する。DSQL は certificates に DB unique 制約を持たない (§11.2 未設置)
	// ため、この service 層 dedup が SQLite uniqueIndex / DynamoDB attribute_not_exists との
	// backend 間機能等価を成立させる唯一の防御になる。
	const seenTypesByChild = new Map<ChildId, Set<string>>();
	async function seenTypes(childId: ChildId): Promise<Set<string>> {
		let set = seenTypesByChild.get(childId);
		if (!set) {
			const rows = await getRepos().certificate.findCertificates(childId, tenantId);
			set = new Set(rows.map((r) => r.certificateType));
			seenTypesByChild.set(childId, set);
		}
		return set;
	}

	for (const cert of certs) {
		const childId = childIdMap.get(cert.childRef);
		if (!childId) {
			result.certificatesSkipped++;
			continue;
		}
		const types = await seenTypes(childId);
		if (types.has(cert.certificateType)) {
			result.certificatesSkipped++;
			result.skipped.constraint++;
			result.warnings.push(
				`証明書重複スキップ (child=${cert.childRef}, type=${cert.certificateType})`,
			);
			continue;
		}
		try {
			const restored = await getRepos().certificate.insertForRestore(
				{
					childId,
					certificateType: cert.certificateType,
					title: cert.title,
					description: cert.description,
					issuedAt: cert.issuedAt,
					metadata: cert.metadata,
				},
				tenantId,
			);
			if (restored) {
				result.certificatesImported++;
				types.add(cert.certificateType);
			} else {
				// DB 層 guard (onConflictDoNothing / attribute_not_exists) での重複 skip、
				// または demo backend の書込 no-op。
				result.certificatesSkipped++;
				result.skipped.constraint++;
			}
		} catch (e) {
			// #3401 例外分類: throttle / network 等の真の write 失敗のみここに到達する
			// (重複は null 返却で上の分岐)。errors に可視化する。
			result.certificatesSkipped++;
			result.errors.push(
				`証明書 insert 失敗 (child=${cert.childRef}, type=${cert.certificateType}): ${String(e)}`,
			);
		}
	}
}

/**
 * parentMessage の verbatim 値検証 (#3414 item 2、default-deny)。
 * 改竄/破損 backup の未知 messageType・範囲外 bonusPoints・不正日時が子供画面のおうえん描画
 * (ParentMessageOverlay / 履歴ソート) を壊さないよう、import 境界で弾く。
 * @returns 不正理由 (valid なら null)
 */
function validateParentMessageRow(m: {
	messageType: string;
	stampCode: string | null;
	body: string | null;
	icon: string;
	sentAt: string;
	shownAt: string | null;
	bonusPoints: number | null;
}): string | null {
	if (!(MESSAGE_TYPES as readonly string[]).includes(m.messageType)) {
		return `未知の messageType「${m.messageType}」`;
	}
	if (m.messageType === 'stamp' && !m.stampCode) return 'stamp に stampCode がありません';
	if (m.stampCode !== null && m.stampCode.length > 30) return 'stampCode が長すぎます';
	if (m.body !== null && m.body.length > MESSAGE_TEXT_MAX_LENGTH) return 'body が長すぎます';
	if (m.icon.length > 10) return 'icon が長すぎます';
	if (!isValidBonusPoints(m.bonusPoints)) return `bonusPoints が範囲外 (${m.bonusPoints})`;
	if (!isValidIsoDateTime(m.sentAt)) return `sentAt が不正 (${m.sentAt})`;
	if (m.shownAt !== null && !isValidIsoDateTime(m.shownAt)) return `shownAt が不正 (${m.shownAt})`;
	return null;
}

/**
 * 親→子おうえんメッセージ (stamp/text/reward_notice) を復元する (#3329)。
 * childRef で取込先 child に解決し insertForRestore で sentAt / shownAt (既読) を保全して書き戻す。
 *
 * #3414: id-addressable append で DB 自然キーが無いため、merge mode では
 * (messageType, stampCode, body, sentAt) の content key で 既存行 + 同一 import 内 を dedup し、
 * 同一 backup 再取込の全件複製を防ぐ (verbatim = cutover は正当な同時刻複数行を保全するため bypass)。
 * verbatim 値検証 (validateParentMessageRow) は mode 不問で適用する (整合性 skip は #3653 準拠)。
 */
async function importParentMessagesData(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
	mode: ImportMode = 'merge',
): Promise<void> {
	const messages = data.data.parentMessages ?? [];
	if (messages.length === 0) return;

	const contentKey = (m: {
		messageType: string;
		stampCode: string | null;
		body: string | null;
		sentAt: string;
	}) => `${m.messageType}|${m.stampCode ?? ''}|${m.body ?? ''}|${m.sentAt}`;

	// merge mode: 取込先 child の既存メッセージ content key を prefetch (再取込冪等化)。
	const existingKeysByChild = new Map<ChildId, Set<string>>();
	async function existingKeys(childId: ChildId): Promise<Set<string>> {
		let set = existingKeysByChild.get(childId);
		if (!set) {
			const rows = await getRepos().message.findMessages(
				childId,
				RESTORE_DEDUP_FETCH_LIMIT,
				tenantId,
			);
			set = new Set(rows.map(contentKey));
			existingKeysByChild.set(childId, set);
		}
		return set;
	}

	for (const m of data.data.parentMessages ?? []) {
		const childId = childIdMap.get(m.childRef);
		if (!childId) {
			// #3414 item 3: childRef 未解決の silent skip をやめ、欠落を親に可視化する。
			result.parentMessagesSkipped++;
			result.warnings.push(
				`メッセージスキップ: childRef「${m.childRef}」(type=${m.messageType}) が解決できません`,
			);
			continue;
		}
		const invalidReason = validateParentMessageRow(m);
		if (invalidReason) {
			result.parentMessagesSkipped++;
			result.warnings.push(`メッセージスキップ (child=${m.childRef}): ${invalidReason}`);
			continue;
		}
		if (mode === 'merge') {
			const keys = await existingKeys(childId);
			const key = contentKey(m);
			if (keys.has(key)) {
				result.parentMessagesSkipped++;
				result.skipped.constraint++;
				continue;
			}
			keys.add(key);
		}
		try {
			const restored = await getRepos().message.insertForRestore(
				{
					childId,
					messageType: m.messageType,
					stampCode: m.stampCode,
					body: m.body,
					icon: m.icon,
					sentAt: m.sentAt,
					shownAt: m.shownAt,
					bonusPoints: m.bonusPoints,
					rewardCategory: m.rewardCategory,
				},
				tenantId,
			);
			// null = 永続化なし (demo no-op stub)。imported に加算しない (#2263 count 偽装防止)。
			if (restored) result.parentMessagesImported++;
			else result.parentMessagesSkipped++;
		} catch (e) {
			result.parentMessagesSkipped++;
			result.errors.push(
				`メッセージ insert 失敗 (child=${m.childRef}, type=${m.messageType}): ${String(e)}`,
			);
		}
	}
}

/**
 * per-child 活動設定 (ピン留め) を復元する (#3329)。
 * childRef で取込先 child を、activityName で取込先 childActivity (activityLookupByChild) を解決し、
 * insertForRestore で isPinned/pinOrder/日時を保全する。child or activity が解決できない pref は skip。
 */
async function importActivityPrefsData(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	activityLookupByChild: Map<ChildId, Map<string, { id: ActivityId; name: string }>>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	for (const p of data.data.activityPrefs ?? []) {
		const childId = childIdMap.get(p.childRef);
		if (!childId) {
			result.activityPrefsSkipped++;
			continue;
		}
		const activity = activityLookupByChild.get(childId)?.get(p.activityName);
		if (!activity) {
			result.activityPrefsSkipped++;
			continue;
		}
		try {
			const restored = await getRepos().activityPref.insertForRestore(
				{
					childId,
					activityId: activity.id,
					isPinned: p.isPinned,
					pinOrder: p.pinOrder,
					createdAt: p.createdAt,
					updatedAt: p.updatedAt,
				},
				tenantId,
			);
			// #3394/#3465 統一冪等契約: null = 同 (child, activity) 重複 skip (within-child 同名活動が
			// name 再結合で同一 activityId に縮約されたケースを含む)。imported に加算しない。
			if (restored) {
				result.activityPrefsImported++;
			} else {
				result.activityPrefsSkipped++;
				result.skipped.constraint++;
				result.warnings.push(
					`活動設定重複スキップ (child=${p.childRef}, activity=${p.activityName})`,
				);
			}
		} catch (e) {
			result.activityPrefsSkipped++;
			result.errors.push(
				`活動設定 insert 失敗 (child=${p.childRef}, activity=${p.activityName}): ${String(e)}`,
			);
		}
	}
}

/**
 * チェックリスト日次 override (特定日の項目追加/スキップ) を復元する (#3329)。
 * childRef で取込先 child に解決し insertOverrideForRestore で createdAt を保全して書き戻す。
 */
async function importChecklistOverridesData(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	for (const o of data.data.checklistOverrides ?? []) {
		const childId = childIdMap.get(o.childRef);
		if (!childId) {
			result.checklistOverridesSkipped++;
			continue;
		}
		// #3473 item 3: untrusted backup 由来の action/itemName/icon/targetDate を restore 境界で
		// sanitize する。enum 外 action は子供画面フィルタにヒットせず silent 破損になるため、
		// verbatim 書き戻しをやめ拒否を errors に可視化する (owner 復元でも fail-safe)。
		const sanitized = sanitizeChecklistOverrideRestore({
			targetDate: o.targetDate,
			action: o.action,
			itemName: o.itemName,
			icon: o.icon,
			createdAt: o.createdAt,
		});
		if (!sanitized.ok) {
			result.checklistOverridesSkipped++;
			result.errors.push(
				`チェックリスト override 検証失敗 (child=${o.childRef}, date=${String(o.targetDate)}): ${sanitized.reason}`,
			);
			continue;
		}
		try {
			const restored = await insertOverrideForRestore(
				{
					childId,
					targetDate: sanitized.value.targetDate,
					action: sanitized.value.action,
					itemName: sanitized.value.itemName,
					icon: sanitized.value.icon,
					createdAt: sanitized.value.createdAt,
				},
				tenantId,
			);
			// #3394: null = 永続化なし (demo no-op stub)。imported に加算しない (#2263 count 偽装防止)。
			if (restored) result.checklistOverridesImported++;
			else result.checklistOverridesSkipped++;
		} catch (e) {
			result.checklistOverridesSkipped++;
			result.errors.push(
				`チェックリスト override insert 失敗 (child=${o.childRef}, date=${o.targetDate}): ${String(e)}`,
			);
		}
	}
}

/** voiceRelPath (`voices/<oldChildId>/<rest>`) の rest 部を抽出する正規表現 (#3329)。 */
const VOICE_REL_PATH_RE = /^voices\/\d+\/(.+)$/;

/**
 * 子のカスタム音声 DB 行を復元する (#3329)。
 * childRef で取込先 child に解決し、voiceRelPath から rest (uuid.ext) を取り出して
 * filePath = `<tenantPrefix>voices/<newChildId>/<rest>` / publicUrl = `/<filePath>` を新環境向けに
 * 再構成して書き戻す (音声ファイル本体は #3077 importStaticFiles が同一パスへ復元済)。createdAt/
 * scene/label/durationMs/isActive を保全。child or path 解決不能行は skip。
 *
 * #3781: childVoice DB 行 ↔ #3077 ファイル本体の dangling 相互整合を fail-closed 検証する。
 * - 前方 (DB 行 → 本体): 参照する本体ファイル (voiceRelPath) が同一 import payload (staticFiles) に
 *   無い行は insert せず skip + warning。JSON-only import (staticFiles 未指定) や ZIP に本体を欠く
 *   backup で「実体の無い publicUrl を指す DB 行」= dangling を生まない (#3490 AC-3 の deferral 解消)。
 * - 逆方向 (本体 → DB 行): どの childVoice からも参照されない voices/* 本体は orphan として warning
 *   で surface する (実害は未参照バイトのみのため fail-closed でなく可視化)。
 */
async function importChildVoicesData(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
	staticFiles?: Record<string, Uint8Array>,
): Promise<void> {
	const voices = data.data.childVoices ?? [];
	// #3781 逆方向: childVoice が参照する本体パス集合。staticFiles 側の未参照 voices/* を orphan 検出。
	const referencedVoicePaths = new Set(voices.map((v) => v.voiceRelPath));

	for (const v of voices) {
		const childId = childIdMap.get(v.childRef);
		if (!childId) {
			result.childVoicesSkipped++;
			continue;
		}
		const rest = VOICE_REL_PATH_RE.exec(v.voiceRelPath)?.[1];
		if (!rest) {
			result.childVoicesSkipped++;
			result.warnings.push(
				`音声スキップ: voiceRelPath「${v.voiceRelPath}」(child=${v.childRef}) を解決できません`,
			);
			continue;
		}
		// CWE-22 path traversal 防御 (default-deny): 正常 export の rest は `<uuid>.<ext>` (storage-keys.ts
		// voiceKey、単一ファイル名) だが、backup は untrusted input。細工 voiceRelPath
		// (`voices/1/../../../../etc/secret`) で rest に `..` / 絶対パス / バックスラッシュ等が紛れ込むと
		// filePath/publicUrl が tenant 境界外を指し cross-tenant LFI 相当になる。importStaticFiles と同じ
		// isSafeRelativePath で rest を検証し、unsafe なら insert せず skip + warning で 1 件落とす
		// (全 restore は止めない)。
		if (!isSafeRelativePath(rest)) {
			result.childVoicesSkipped++;
			result.warnings.push(
				`音声スキップ: voiceRelPath「${v.voiceRelPath}」(child=${v.childRef}) に不正なパスが含まれます`,
			);
			continue;
		}
		// #3781 前方 (fail-closed): 本体ファイルが同一 import payload に無ければ dangling publicUrl を
		// 生むため insert しない。staticFiles のキーは export 時の相対パス (voices/<oldChildId>/<rest>) =
		// v.voiceRelPath と一致する。JSON-only import (staticFiles 未指定) は全 childVoice が本体を欠く。
		if (!staticFiles || !(v.voiceRelPath in staticFiles)) {
			result.childVoicesSkipped++;
			result.warnings.push(
				`音声スキップ: 本体ファイル「${v.voiceRelPath}」が取込データに含まれないため復元しません (child=${v.childRef})`,
			);
			continue;
		}
		const filePath = `${tenantPrefix(tenantId)}voices/${childId}/${rest}`;
		const publicUrl = storageKeyToPublicUrl(filePath);
		try {
			const restored = await getRepos().voice.insertForRestore(
				{
					childId,
					scene: v.scene,
					label: v.label,
					filePath,
					publicUrl,
					durationMs: v.durationMs,
					isActive: v.isActive,
					tenantId,
					createdAt: v.createdAt,
				},
				tenantId,
			);
			// #3394: null = 永続化なし (demo no-op stub)。imported に加算しない (#2263 count 偽装防止)。
			if (restored) result.childVoicesImported++;
			else result.childVoicesSkipped++;
		} catch (e) {
			result.childVoicesSkipped++;
			result.errors.push(`音声 insert 失敗 (child=${v.childRef}, scene=${v.scene}): ${String(e)}`);
		}
	}

	// #3781 逆方向: staticFiles に含まれるが、どの childVoice DB 行からも参照されない voices/* 本体を
	// orphan として surface する (importStaticFiles が storage に配置しても参照する DB 行が無い状態)。
	warnUnreferencedVoiceFiles(staticFiles, referencedVoicePaths, result);
}

/**
 * #3781 逆方向: staticFiles の voices/* のうち、どの childVoice DB 行からも参照されない本体を
 * orphan として warning で surface する (実害は未参照バイトのみのため fail-closed でなく可視化)。
 */
function warnUnreferencedVoiceFiles(
	staticFiles: Record<string, Uint8Array> | undefined,
	referencedVoicePaths: Set<string>,
	result: ImportResult,
): void {
	if (!staticFiles) return;
	for (const relPath of Object.keys(staticFiles)) {
		if (relPath.startsWith('voices/') && !referencedVoicePaths.has(relPath)) {
			result.warnings.push(
				`音声本体「${relPath}」は参照する音声データが無いため未参照ファイルになります`,
			);
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
		certificatesImported: 0,
		certificatesSkipped: 0,
		parentMessagesImported: 0,
		parentMessagesSkipped: 0,
		checklistOverridesImported: 0,
		checklistOverridesSkipped: 0,
		childVoicesImported: 0,
		childVoicesSkipped: 0,
		activityPrefsImported: 0,
		activityPrefsSkipped: 0,
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
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
	enforceQuota: boolean,
): Promise<void> {
	// #4693 (QM #4784): 復元も他の取込経路と同じ quota gate を通す (PO 判断「復元 / REST も
	// 素通りさせない」)。先に書き込み計画を作り、上限超過分 (custom 行のみが対象、seed 行は
	// 数えない = 初期 seed の復元を切り詰めない) を計画から外してから insert する。
	const { childInputsByChild, plannedNewNames } = planChildActivityRestores(
		data,
		childIdMap,
		result,
	);

	// verbatim (cutover / seed) では quota を掛けず、module も読み込まない (上記 ImportOptions.enforceQuota)。
	const quota = enforceQuota
		? await (await import('./activity-quota')).enforceActivityQuota(
				tenantId,
				childInputsByChild,
				plannedNewNames,
			)
		: null;
	if (quota && quota.rejectedRows > 0) {
		result.blocked = {
			count: quota.rejectedRows,
			message: quota.message,
			upgradeUrl: quota.upgradeUrl,
		};
		for (const name of quota.rejectedNames) {
			result.warnings.push(`活動「${name}」はプラン上限のため復元しませんでした: ${quota.message}`);
		}
	}

	for (const [childId, inputs] of childInputsByChild) {
		for (const input of inputs) {
			try {
				await getRepos().childActivity.insertActivity(input, tenantId);
				result.activitiesCreated++;
			} catch (e) {
				result.warnings.push(`活動「${input.name}」(child=${childId}) の作成に失敗: ${String(e)}`);
			}
		}
	}
}

/** 復元する child_activities の書き込み計画 (childRef / category が解決できない行は warnings に落とす)。 */
function planChildActivityRestores(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	result: ImportResult,
): { childInputsByChild: Map<ChildId, InsertChildActivityInput[]>; plannedNewNames: Set<string> } {
	const childActivities = data.data.childActivities ?? [];
	const childInputsByChild = new Map<ChildId, InsertChildActivityInput[]>();
	const plannedNewNames = new Set<string>();
	for (const a of childActivities) {
		const childId = childIdMap.get(a.childRef);
		if (!childId) {
			result.warnings.push(`活動「${a.name}」スキップ: childRef「${a.childRef}」が解決できません`);
			continue;
		}
		const categoryId = categoryIdFromCode(a.categoryCode);
		if (!categoryId) {
			result.warnings.push(`活動「${a.name}」のカテゴリ「${a.categoryCode}」が不明のためスキップ`);
			continue;
		}
		const inputs = childInputsByChild.get(childId) ?? [];
		inputs.push({
			childId,
			name: a.name,
			categoryId,
			icon: a.icon,
			basePoints: a.basePoints,
			triggerHint: a.triggerHint ?? null,
			isMainQuest: a.isMainQuest ?? 0,
			sourcePresetId: a.sourcePresetId ?? null,
			priority: a.priority === 'must' ? 'must' : 'optional',
			// #3358: 表示状態 / 並び順 / アーカイブ状態を round-trip 復元
			// (省略 = 旧 backup 後方互換で schema default)。archived→active 復活防止。
			isVisible: a.isVisible,
			sortOrder: a.sortOrder,
			isArchived: a.isArchived,
			archivedReason: a.archivedReason ?? null,
			// #3422: 1 日上限 / 読み仮名 / 漢字表記を round-trip 復元 (省略 = 旧 backup は
			// schema default)。dailyLimit=0 (無制限) を null=1 回固定へ落とさず保全する。
			// #3463 item1: import 境界で値検証。改竄/破損 ZIP の範囲外 dailyLimit (NaN/負/巨大/非整数) を
			// [0,99] int or null に、巨大 nameKana/nameKanji を max 50 char に正規化する (default-deny)。
			dailyLimit: sanitizeDailyLimit(a.dailyLimit),
			nameKana: sanitizeActivityNameField(a.nameKana),
			nameKanji: sanitizeActivityNameField(a.nameKanji),
			// #4693 (QM): 作成経路を round-trip 復元する。落とすと repo 既定 `seed` に化け、
			// 保護者が自分で作った活動 (`custom`) が quota の集計から消える
			// = backup → restore を 1 回するだけで「オリジナル活動 3 個まで」が無効になる。
			// 値域外 / 旧 backup (field 無し) は既定に落とす (default-deny、#3463 item1 と同方針)。
			// 顧客が backup を編集して `custom` を並べても、下の quota gate が上限で切る。
			source: sanitizeActivitySource(a.source),
		});
		childInputsByChild.set(childId, inputs);
		plannedNewNames.add(a.name);
	}
	return { childInputsByChild, plannedNewNames };
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
	childIdMap: Map<string, ChildId>,
	tenantId: string,
): Promise<Map<ChildId, Map<string, { id: ActivityId; name: string }>>> {
	const lookup = new Map<ChildId, Map<string, { id: ActivityId; name: string }>>();
	const childActivityRepo = getRepos().childActivity;
	for (const childId of new Set(childIdMap.values())) {
		const activities = await childActivityRepo.findActivitiesByChild(childId, tenantId, {
			includeArchived: true,
		});
		const byName = new Map<string, { id: ActivityId; name: string }>();
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
): Promise<Map<string, ChildId>> {
	const childIdMap = new Map<string, ChildId>();
	for (const exportChild of data.family.children) {
		try {
			const child = await insertChild(
				{
					nickname: exportChild.nickname,
					age: exportChild.age,
					theme: exportChild.theme,
					uiMode: exportChild.uiMode,
					birthDate: exportChild.birthDate ?? undefined,
					// #4718 (QM): 手動フラグは round-trip した値を使い、復元側で導出しない。
					// 旧 backup (本 field 無し) は undefined → repo 側で従来どおり導出に落ちる。
					uiModeManuallySet: exportChild.uiModeManuallySet,
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
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	for (const status of data.data.statuses) {
		const childId = childIdMap.get(status.childRef);
		const categoryId = categoryIdFromCode(status.categoryCode);
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
// biome-ignore lint/complexity/useMaxParams: import ヘルパ群の既存引数列 + mode (#3653)。オブジェクト引数化は import 系一括 refactor (別 Issue) で扱う
async function importActivityLogsData(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	activityLookupByChild: Map<ChildId, Map<string, { id: ActivityId; name: string }>>,
	tenantId: string,
	result: ImportResult,
	mode: ImportMode = 'merge',
): Promise<void> {
	const existingLogKeysByChild = new Map<ChildId, Set<string>>();
	// #3327: 「見つからない」warning の dedup は (childId, name) で行う。name のみだと
	// 子 A で欠落・子 B で存在のケースで正当な warning を抑制してしまう。
	const missingActivityKeys = new Set<string>();

	// #3692 phase 0: merge dedup に使う既存ログキーを、登場する child 分だけ並列 prefetch
	if (mode === 'merge') {
		const involvedChildIds = [
			...new Set(
				data.data.activityLogs
					.map((log) => childIdMap.get(log.childRef))
					.filter((id): id is ChildId => !!id),
			),
		];
		await runConcurrent(involvedChildIds, async (childId) => {
			await getOrFetchActivityLogKeys(childId, tenantId, existingLogKeysByChild);
		});
	}

	// #3692 phase 1 (同期): activity 解決 + dedup 判定を同期で確定する。dedup Set の
	// 参照/更新が insert await を跨ぐと並列化で race するため、Set 操作はここで完結させる。
	const tasks: {
		childId: ChildId;
		activityId: ActivityId;
		log: (typeof data.data.activityLogs)[number];
	}[] = [];
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

		// #3653: (activityName, recordedAt) dedup は merge のみ。verbatim (cutover) では同時刻の
		// 正当な複数記録 (DB 一意制約なし) を全行復元する。
		if (mode === 'merge') {
			const existingKeys = existingLogKeysByChild.get(childId);
			const key = `${log.activityName}:${log.recordedAt}`;
			if (existingKeys?.has(key)) {
				result.activityLogsSkipped++;
				result.skipped.constraint++;
				continue;
			}
			existingKeys?.add(key);
		}
		tasks.push({ childId, activityId: activity.id, log });
	}

	// #3692 phase 2: insert を並列チャンク実行 (dedup 確定済みで行間依存なし)
	await runConcurrent(tasks, async ({ childId, activityId, log }) => {
		try {
			await insertActivityLog(
				{
					childId,
					activityId,
					points: log.points,
					streakDays: log.streakDays,
					streakBonus: log.streakBonus,
					recordedDate: log.recordedDate,
					recordedAt: log.recordedAt,
				},
				tenantId,
			);
			result.activityLogsImported++;
		} catch (e) {
			result.activityLogsSkipped++;
			result.errors.push(
				`活動ログ insert 失敗 (child=${log.childRef}, activity=${log.activityName}): ${String(e)}`,
			);
		}
	});
}

async function getOrFetchActivityLogKeys(
	childId: ChildId,
	tenantId: string,
	cache: Map<ChildId, Set<string>>,
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
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	// #3692 phase 1 (同期): childId 解決と insert 対象確定
	const tasks: { childId: ChildId; entry: (typeof data.data.pointLedger)[number] }[] = [];
	for (const entry of data.data.pointLedger) {
		const childId = childIdMap.get(entry.childRef);
		if (!childId) {
			result.pointLedgerSkipped++;
			continue;
		}
		tasks.push({ childId, entry });
	}
	// #3692 phase 2 改 (本番 DSQL restore 障害の根治): 並列は **child 間のみ**。
	//
	// 旧実装は全 entry を 25 並列で insertPointLedger していたが、point 書込プリミティブ
	// (point-write.ts) は「ledger INSERT + **同一 children 行の total_point += UPDATE**」を
	// 1 txn で行う (§6.2 compute-on-write)。つまり台帳は append-only でも **children 行が
	// 共有 write 先**であり、同一 child の entry を並列化すると DSQL (OCC) では write-write
	// 衝突が COMMIT 時に 40001 で abort する (occ-retry maxAttempts=3 では 25 並列 × 数百行の
	// 競合に耐えられない)。本番実 zip (772 entries / 2 children) の restore が
	// 「Failed query: commit」で abort した実障害 (2026-07-15)。
	//
	// child ごとに entry を group し、child 内は逐次 / child 間のみ並列にすることで
	// 同一 children 行への並行 write を構造的に排除する (ADR-0065 原則 2 の write 束ね方向。
	// DynamoDB / PGlite / sqlite の意味論は不変)。PGlite が単一接続逐次のため OCC 衝突を
	// 再現できない盲点は、実 zip fixture + 並列検証 (#3683) で担保する。
	const byChild = new Map<
		ChildId,
		{ childId: ChildId; entry: (typeof tasks)[number]['entry'] }[]
	>();
	for (const task of tasks) {
		const list = byChild.get(task.childId);
		if (list) {
			list.push(task);
		} else {
			byChild.set(task.childId, [task]);
		}
	}
	await runConcurrent([...byChild.values()], async (childTasks) => {
		for (const { childId, entry } of childTasks) {
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
	});
}

/**
 * ログインボーナス counter import (#3330 案 B counter 縮約)。
 * per-child 1 行の counter を upsertStreak で merge する。repo 側の conditional upsert が
 * 「lastLoginDate が新しい方 (同日なら streak 大) を残す」ため、同一 backup の再取込 (merge) や
 * 既存 counter がより新しい場合は skip される (dedup pre-fetch 不要、mode 非依存)。
 */
async function importLoginStreaksData(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	for (const streak of data.data.loginStreaks ?? []) {
		const childId = childIdMap.get(streak.childRef);
		if (!childId) continue;
		try {
			const written = await upsertStreak(
				{
					childId,
					lastLoginDate: streak.lastLoginDate,
					currentStreak: streak.currentStreak,
					updatedAt: streak.updatedAt,
				},
				tenantId,
			);
			if (written) {
				result.loginBonusesImported++;
			} else {
				result.loginBonusesSkipped++;
				result.skipped.constraint++;
			}
		} catch (e) {
			result.loginBonusesSkipped++;
			result.errors.push(
				`ログインボーナス counter upsert 失敗 (child=${streak.childRef}, lastLoginDate=${streak.lastLoginDate}): ${String(e)}`,
			);
		}
	}
}

/** checklistLog の再マップに使う、childId 単位の template id 解決マップ群。 */
export interface ChecklistTemplateIdMaps {
	/** templateName → templateId (#3078、旧 export の fallback 用) */
	byName: Map<ChildId, Map<string, string>>;
	/** exportId → templateId (#3107、同名 template 取り違え防止の安定キー) */
	byExportId: Map<ChildId, Map<string, string>>;
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
	idByName: Map<string, string>;
	idByPreset: Map<string, string>;
	/** exportId → templateId (#3107 round-trip キー、当 import data の exportId のみ) */
	exportIdToId: Map<string, string>;
}

/** child の既存 template から import 状態を初期化する。 */
async function loadChildChecklistState(
	childId: ChildId,
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
// biome-ignore lint/complexity/useMaxParams: import ヘルパ群の既存引数列 + mode (#3653)。オブジェクト引数化は import 系一括 refactor (別 Issue) で扱う
async function importOneChecklistTemplate(
	tpl: ExportData['data']['checklistTemplates'][number],
	childId: ChildId,
	state: ChildChecklistState,
	tenantId: string,
	result: ImportResult,
	mode: ImportMode = 'merge',
): Promise<void> {
	// #3107: 解決先 templateId を round-trip キー (exportId) に登録する (スキップ時も既存 id を登録)。
	const register = (templateId: string) => {
		if (tpl.exportId) state.exportIdToId.set(tpl.exportId, templateId);
	};

	// #3107: 同一 import data 内に同じ exportId が 2 度現れたら真の重複 → 既存解決先を再登録して skip。
	//   (export-service は templateId ごとに distinct exportId を発番するため通常は発生しないが防御的に処理)
	//   #3653: exportId は source template ごとに distinct 保証 = 真の重複判定のため verbatim でも維持。
	if (tpl.exportId && state.exportIdToId.has(tpl.exportId)) {
		result.skipped.name++;
		return;
	}

	// #1254 G1: preset_duplicate → name_duplicate の順で判定 (merge のみ、#3653。verbatim = cutover は
	// name/preset に DB 一意制約が無く、正当な同名 template を collapse させないため bypass)
	if (mode === 'merge' && tpl.sourcePresetId && state.presetIds.has(tpl.sourcePresetId)) {
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
	if (mode === 'merge' && nameDedupSet.has(tpl.name)) {
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
				// #3505 (#3358 と同一クラス): archive 状態を round-trip 保全。未渡しだと import 後に
				// archived template が active 復活する (display filter が isArchived===1 のみ除外するため)。
				isArchived: tpl.isArchived ? 1 : 0,
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
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
	mode: ImportMode = 'merge',
): Promise<ChecklistTemplateIdMaps> {
	const stateByChild = new Map<ChildId, ChildChecklistState>();

	for (const tpl of data.data.checklistTemplates) {
		const childId = childIdMap.get(tpl.childRef);
		if (!childId) continue;

		let state = stateByChild.get(childId);
		if (!state) {
			state = await loadChildChecklistState(childId, tenantId);
			stateByChild.set(childId, state);
		}
		await importOneChecklistTemplate(tpl, childId, state, tenantId, result, mode);
	}

	const byName = new Map<ChildId, Map<string, string>>();
	const byExportId = new Map<ChildId, Map<string, string>>();
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
	childIdMap: Map<string, ChildId>,
	templateIdMaps: ChecklistTemplateIdMaps,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	const existingKeysByChild = new Map<ChildId, Set<string>>();

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
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	// #3692 phase 1 (同期): childId / categoryId 解決と insert 対象確定
	const tasks: {
		childId: ChildId;
		categoryId: CategoryId;
		sh: (typeof data.data.statusHistory)[number];
	}[] = [];
	for (const sh of data.data.statusHistory) {
		const childId = childIdMap.get(sh.childRef);
		const categoryId = categoryIdFromCode(sh.categoryCode);
		if (!childId || !categoryId) continue;
		tasks.push({ childId, categoryId, sh });
	}
	// #3692 phase 2: insert を並列チャンク実行 (履歴は append-only で行間依存なし)
	await runConcurrent(tasks, async ({ childId, categoryId, sh }) => {
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
	});
}

/** child 単位の specialReward import 状態 (既存 + 当 import で作成した reward の id 解決)。 */
interface SpecialRewardChildState {
	titles: Set<string>;
	presetIds: Set<string>;
	idByTitle: Map<string, string>;
	idByPreset: Map<string, string>;
}

/** child の既存 reward から import 状態を初期化する (#3381)。 */
async function loadSpecialRewardState(
	childId: ChildId,
	tenantId: string,
): Promise<SpecialRewardChildState> {
	const rows = await findSpecialRewards(childId, tenantId);
	return {
		titles: new Set(rows.map((r) => r.title)),
		presetIds: new Set(rows.map((r) => r.sourcePresetId).filter((p): p is string => !!p)),
		idByTitle: new Map(rows.map((r) => [r.title, r.id])),
		idByPreset: new Map(
			rows.filter((r) => r.sourcePresetId).map((r) => [r.sourcePresetId as string, r.id]),
		),
	};
}

/**
 * 1 件の specialReward を import (重複スキップ / 新規作成) し、解決先 rewardId を register に渡す (#3381)。
 * skip 時も既存 rewardId を register し、交換履歴が正しい reward に再結合できるようにする
 * (#3107 checklist の register と同型)。
 */
// biome-ignore lint/complexity/useMaxParams: import ヘルパ群の既存引数列に合わせる (checklist と同型)。
async function importOneSpecialReward(
	sr: ExportData['data']['specialRewards'][number],
	childId: ChildId,
	state: SpecialRewardChildState,
	tenantId: string,
	result: ImportResult,
	register: (rewardId: string) => void,
	mode: ImportMode,
): Promise<void> {
	// #1254 G1: preset_duplicate → name_duplicate の順で判定 (merge のみ、#3653)。
	// verbatim (cutover) では同 child 同 title の正当な複数行 (title に DB 一意制約なし、
	// NUC cycle 3 で export=9 → imported=2 の実欠落) を全行復元する。
	if (mode === 'merge' && sr.sourcePresetId && state.presetIds.has(sr.sourcePresetId)) {
		result.specialRewardsSkipped++;
		result.skipped.preset++;
		const dupId = state.idByPreset.get(sr.sourcePresetId);
		if (dupId !== undefined) register(dupId);
		return;
	}
	if (mode === 'merge' && state.titles.has(sr.title)) {
		result.specialRewardsSkipped++;
		result.skipped.name++;
		const dupId = state.idByTitle.get(sr.title);
		if (dupId !== undefined) register(dupId);
		return;
	}

	try {
		const created = await insertSpecialReward(
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
		state.titles.add(sr.title);
		state.idByTitle.set(sr.title, created.id);
		if (sr.sourcePresetId) {
			state.presetIds.add(sr.sourcePresetId);
			state.idByPreset.set(sr.sourcePresetId, created.id);
		}
		register(created.id);
	} catch (e) {
		result.errors.push(`ごほうび「${sr.title}」のインポートに失敗: ${String(e)}`);
	}
}

/**
 * ごほうび (specialReward) を import し、`exportId → 新 rewardId` の再結合マップを返す (#3329 / #3381)。
 *
 * #3381: 返すマップは交換履歴 (importRewardRedemptionsData) が **安定識別子 (exportId)** で reward を
 * 再結合するための SSOT。新規 insert / 重複 skip いずれの reward も exportId → 解決先 rewardId を登録する
 * ため、reward が改名されても / 同名 reward が複数あっても交換履歴を取り違えない。exportId を持たない旧
 * backup は本マップに載らず、履歴側が title (rewardRef) で fallback する。
 */
async function importSpecialRewards(
	data: ExportData,
	childIdMap: Map<string, ChildId>,
	tenantId: string,
	result: ImportResult,
	mode: ImportMode = 'merge',
): Promise<Map<ChildId, Map<string, string>>> {
	// #3381: exportId → 解決先 rewardId (child 単位)。交換履歴の安定再結合キー。
	const rewardIdByExportId = new Map<ChildId, Map<string, string>>();
	const stateByChild = new Map<ChildId, SpecialRewardChildState>();

	for (const sr of data.data.specialRewards) {
		const childId = childIdMap.get(sr.childRef);
		if (!childId) continue;

		let state = stateByChild.get(childId);
		if (!state) {
			state = await loadSpecialRewardState(childId, tenantId);
			stateByChild.set(childId, state);
		}

		const register = (rewardId: string) => {
			if (!sr.exportId) return;
			let m = rewardIdByExportId.get(childId);
			if (!m) {
				m = new Map<string, string>();
				rewardIdByExportId.set(childId, m);
			}
			m.set(sr.exportId, rewardId);
		};

		await importOneSpecialReward(sr, childId, state, tenantId, result, register, mode);
	}

	if (result.specialRewardsSkipped > 0) {
		result.warnings.push(
			`ごほうび ${result.specialRewardsSkipped} 件が既存と同名または同一プリセットのためスキップされました`,
		);
	}
	return rewardIdByExportId;
}

// ============================================================
// 静的ファイル (アバター画像 / 音声) の復元 (#3077)
// ============================================================

/** 静的ファイル ZIP 相対パスの形式: `<type>/<childId>/<rest...>` (type = avatars|voices|generated) */
const STATIC_FILE_PATH_RE = /^(avatars|voices|generated)\/(\d+)\/(.+)$/;

/**
 * 相対 storage パスに path-escape (`..` や絶対パス) が含まれていないか検証する (zip-slip / CWE-22 防御)。
 * `STATIC_FILE_PATH_RE` の `rest` (`.+`、importStaticFiles) / `VOICE_REL_PATH_RE` の `rest`
 * (`.+`、importChildVoicesData) は任意文字を許すため、ここで `..` セグメント・先頭スラッシュ・
 * Windows ドライブ・バックスラッシュ・NUL/制御文字等を弾く。安全なら true。
 *
 * #3490: NUL/制御文字も拒否する (poison-null-byte / CWE-22 の理論上残余)。本パスは現状 FS read に
 * 直結せず DB 行 + publicUrl 参照に留まるため実害は無いが、「path に制御文字を混在させない」不変条件を
 * 明示強制し、将来 storage 実装が FS/URL parse に渡しても切詰め攻撃が成立しないようにする。
 */
function isSafeRelativePath(relPath: string): boolean {
	// NUL / 制御文字 (C0 0x00-0x1f / DEL 0x7f / C1 0x80-0x9f) を含むパスは無条件拒否する (#3490)。
	for (let i = 0; i < relPath.length; i++) {
		const code = relPath.charCodeAt(i);
		if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
	}
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
	childIdMap: Map<string, ChildId>,
	staticFiles: Record<string, Uint8Array>,
	tenantId: string,
	result: ImportResult,
): Promise<void> {
	// sourceChildId (export 元 id、旧 backup は number / 新 backup は string) → 新 childId。
	// String() 正規化で新旧 backup 双方の key を同一視する。
	const oldChildToNew = new Map<string, ChildId>();
	for (const child of data.family.children) {
		const newId = childIdMap.get(child.exportId);
		if (child.sourceChildId != null && newId) {
			oldChildToNew.set(String(child.sourceChildId), newId);
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
		const newChildId = oldChildToNew.get(String(oldChildIdStr));
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
	childIdMap: Map<string, ChildId>;
	/** sourceChildId (export 元 id) → 新 childId */
	oldChildToNew: Map<string, ChildId>;
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
	const persist = async (childId: ChildId, url: string | null, exportId: string): Promise<void> => {
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
		oldChildToNew: Map<string, ChildId>;
		newChildId: ChildId;
	},
): string | null | undefined {
	const hit = ctx.relativeKeyRemap.get(oldRelPath);
	if (hit) return hit;

	const relMatch = STATIC_FILE_PATH_RE.exec(oldRelPath);
	const type = relMatch?.[1];
	const oldChildIdStr = relMatch?.[2];
	const rest = relMatch?.[3];
	if (!type || !oldChildIdStr || !rest) return undefined;

	const mappedChildId = ctx.oldChildToNew.get(String(oldChildIdStr)) ?? ctx.newChildId;
	const candidate = `${type}/${mappedChildId}/${rest}`;
	// unsafe (`..` / 絶対パス) は fileExists で probe (存在オラクル化) / 永続化させない。
	if (!isSafeRelativePath(candidate)) return null;
	return candidate;
}

// Re-export labels type for API handler
export { IMPORT_LABELS };
