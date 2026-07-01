// src/lib/server/services/cloud-export-service.ts
// クラウドエクスポート共有サービス（PIN付きS3保管 + インポート）

import { randomInt } from 'node:crypto';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { getRepos } from '$lib/server/db/factory';
import type { CloudExportRecord, CloudExportType } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';
import { BackupSizeLimitError, buildFullBackupZip } from '$lib/server/services/backup-archive';
import { exportFamilyData } from '$lib/server/services/export-service';
import {
	getPlanLimits,
	type PlanTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';

// PIN生成用の文字セット（O/0/I/1を除外して誤読防止）
const PIN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PIN_LENGTH = 6;
const EXPIRY_DAYS = 7;

/** PIN コードを生成（6桁英数字） */
function generatePin(): string {
	// #1387: Math.random() は暗号論的に非安全で PIN が予測可能になる。
	// 家族データ共有エクスポートを保護する PIN のため crypto.randomInt で
	// 真に一様な乱数を使う。
	let pin = '';
	for (let i = 0; i < PIN_LENGTH; i++) {
		pin += PIN_CHARS[randomInt(0, PIN_CHARS.length)];
	}
	return pin;
}

/** ユニークな PIN を生成（衝突チェック） */
async function generateUniquePin(): Promise<string> {
	const repos = getRepos();
	for (let attempt = 0; attempt < 10; attempt++) {
		const pin = generatePin();
		const existing = await repos.cloudExport.findByPin(pin);
		if (!existing) return pin;
	}
	throw new Error('PIN生成に失敗しました（衝突回避不可）');
}

/** 有効期限を計算（7日後） */
function calculateExpiry(): string {
	const d = new Date();
	d.setDate(d.getDate() + EXPIRY_DAYS);
	return d.toISOString();
}

/**
 * テンプレートエクスポートデータを構築（活動セット + チェックリスト）
 *
 * #2362 PR-3 (ADR-0055) per-child instance 化に伴い、child 別 export shape を採用 (PO 判断 A 案、2026-05-24):
 *   - 旧: tenant-wide 1 集合 `{ activities: [...] }` で出力
 *   - 新: child 別 `{ activitiesByChild: [{ childId, childNickname, activities: [...] }] }` で出力
 * 取込側 (handleTemplateImport) は ChildSelectionDialog 経由で復元先 child を指定する。
 *
 * version 2.0.0 で per-child shape を採用。1.0.0 (旧 family-wide) は本 PR で完全廃止 (0 user)。
 */
/**
 * #3376: クラウド保管するバックアップアーティファクト。
 * template = JSON（data.json、テキスト共有用途）/ full = 画像込み ZIP（backup.zip、完全バックアップ）。
 */
interface CloudExportArtifact {
	bytes: Uint8Array;
	description: string;
	/** S3 オブジェクト名。fetch 側はこの拡張子で zip/json を判別せず、ZIP マジックバイトで判定する。 */
	filename: string;
	contentType: string;
}

async function buildTemplateExportData(tenantId: string): Promise<CloudExportArtifact> {
	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);

	// 子供別 activity 一覧 (per-child instance)
	const activitiesByChild: Array<{
		childId: number;
		childNickname: string;
		activities: Array<{
			name: string;
			categoryId: number;
			icon: string;
			basePoints: number;
			triggerHint: string | null;
			isMainQuest: number;
			priority: string;
		}>;
	}> = [];
	let totalActivityCount = 0;
	for (const child of children) {
		const acts = await repos.childActivity.findActivitiesByChild(child.id, tenantId);
		activitiesByChild.push({
			childId: child.id,
			childNickname: child.nickname,
			activities: acts.map((a) => ({
				name: a.name,
				categoryId: a.categoryId,
				icon: a.icon,
				basePoints: a.basePoints,
				triggerHint: a.triggerHint,
				isMainQuest: a.isMainQuest,
				priority: a.priority,
			})),
		});
		totalActivityCount += acts.length;
	}

	// チェックリストテンプレート（子供ごとに紐づくテンプレートを収集）
	const checklistTemplates: Array<{
		name: string;
		items: Array<{ name: string; icon: string }>;
	}> = [];
	for (const child of children) {
		const templates = await repos.checklist.findTemplatesByChild(child.id, tenantId);
		for (const tpl of templates) {
			const items = await repos.checklist.findTemplateItems(tpl.id, tenantId);
			checklistTemplates.push({
				name: tpl.name,
				items: items.map((it) => ({ name: it.name, icon: it.icon })),
			});
		}
	}

	const templateData = {
		format: 'ganbari-quest-template' as const,
		version: '2.0.0',
		exportedAt: new Date().toISOString(),
		activitiesByChild,
		checklistTemplates,
	};

	const parts: string[] = [];
	if (totalActivityCount > 0) {
		parts.push(`活動${totalActivityCount}件（${activitiesByChild.length}人分）`);
	}
	if (checklistTemplates.length > 0) parts.push(`チェックリスト${checklistTemplates.length}件`);
	const description = parts.join('、') || 'データなし';

	return {
		bytes: new TextEncoder().encode(JSON.stringify(templateData)),
		description,
		filename: 'data.json',
		contentType: 'application/json',
	};
}

/**
 * フルバックアップを構築（#3376: 画像込み ZIP）。
 * ローカル DL と同一の backup-archive.buildFullBackupZip（data.json + 静的ファイル + manifest）を使い、
 * クラウド完全復元（画像込み）を可能にする。ブラウザ DL を介さないため Safe Browsing 警告も発生しない。
 */
async function buildFullExportData(tenantId: string): Promise<CloudExportArtifact> {
	const exportData = await exportFamilyData({ tenantId });
	const childCount = exportData.family.children.length;
	const logCount = exportData.data.activityLogs?.length ?? 0;
	const zipBytes = await buildFullBackupZip(tenantId, exportData, false);
	const description = `フルバックアップ（子供${childCount}人、ログ${logCount}件、画像同梱）`;
	return {
		bytes: zipBytes,
		description,
		filename: 'backup.zip',
		contentType: 'application/zip',
	};
}

export interface CloudExportOptions {
	tenantId: string;
	exportType: CloudExportType;
	label?: string;
	licenseStatus: string;
	planId?: string;
}

export interface CloudExportResult {
	pinCode: string;
	expiresAt: string;
	exportType: CloudExportType;
	/** 非同期 build (#3504)。起票直後は 0、build 完了 (ready) 後に確定する。 */
	fileSizeBytes: number;
	/** 非同期 build (#3504)。起票直後は null、build 完了 (ready) 後に確定する。 */
	description: string | null;
	/** 非同期 build 状態 (#3504)。起票直後は 'pending'。 */
	status: 'pending' | 'building' | 'ready' | 'failed';
}

/** exportType から S3/FS 上の filename を導出（build 前に s3Key を確定するため）。 */
function artifactFilename(exportType: CloudExportType): string {
	// template = JSON (data.json) / full = 画像込み ZIP (backup.zip、#3376)
	return exportType === 'template' ? 'data.json' : 'backup.zip';
}

/**
 * クラウドエクスポートを **起票** する（#3504 async-backup-export.md §3.2）。
 *
 * 同期 build → レスポンス直返しは AWS (Function URL BUFFERED 6MB / Lambda 30 秒) と NUC
 * (生成中の browser/proxy timeout) の双方で破綻するため、本関数は **ZIP を作らず**
 * `status='pending'` のレコードを insert して即返す。実 build は cron の
 * {@link drainPendingExports} が背景で行う。
 */
export async function createCloudExport(options: CloudExportOptions): Promise<CloudExportResult> {
	const { tenantId, exportType, label, licenseStatus, planId } = options;

	// プラン制限チェック
	const tier: PlanTier = await resolveFullPlanTier(tenantId, licenseStatus, planId);
	const limits = getPlanLimits(tier);
	if (limits.maxCloudExports === 0) {
		throw new Error(PLAN_GATE_LABELS.standardOrAboveFor('クラウドエクスポート'));
	}

	// 保管数上限チェック
	const repos = getRepos();
	const currentCount = await repos.cloudExport.countByTenant(tenantId);
	if (currentCount >= limits.maxCloudExports) {
		throw new Error(
			`クラウド保管数の上限（${limits.maxCloudExports}件）に達しています。既存のエクスポートを削除してください`,
		);
	}

	// PIN生成 + s3Key を build 前に確定（filename は exportType から決まる）
	const pinCode = await generateUniquePin();
	const s3Key = `exports/${tenantId}/${pinCode}/${artifactFilename(exportType)}`;

	// DB記録（pending。fileSizeBytes / description は build 完了時に確定する）
	const expiresAt = calculateExpiry();
	await repos.cloudExport.insert({
		tenantId,
		exportType,
		pinCode,
		s3Key,
		fileSizeBytes: 0,
		label: label ?? null,
		description: null,
		expiresAt,
		status: 'pending',
	});

	logger.info('[cloud-export] エクスポート起票 (pending)', {
		context: { tenantId, exportType, pinCode },
	});

	return {
		pinCode,
		expiresAt,
		exportType,
		fileSizeBytes: 0,
		description: null,
		status: 'pending',
	};
}

/** #3509 QM 是正: 'building' 状態の stale 判定閾値 (cron drain 間隔の複数倍を見込んで 10 分)。 */
const STALE_BUILDING_THRESHOLD_MS = 10 * 60 * 1000;

/** {@link drainPendingExports} の実行結果。 */
export interface DrainResult {
	processed: number;
	ready: number;
	failed: number;
	/** #3509: stale 'building' から 'pending' へ reclaim した件数。 */
	reclaimed: number;
}

/**
 * #3509 QM 是正 (async-backup-export.md §3.2 追補): status='building' のまま
 * staleThresholdMs 以上経過したレコード (cron worker が build 中に kill/timeout し
 * 永久 stuck した行) を 'pending' へ差し戻し、次回 drain で再試行対象にする。
 * updateStatus('pending') が buildStartedAt も null にリセットするため、reclaim 後の
 * レコードは通常の pending と区別なく findPendingBuilds に拾われる。
 */
export async function reclaimStaleBuildingExports(
	staleThresholdMs = STALE_BUILDING_THRESHOLD_MS,
): Promise<number> {
	const repos = getRepos();
	const stale = await repos.cloudExport.findStaleBuildingExports(staleThresholdMs);
	for (const record of stale) {
		await repos.cloudExport.updateStatus(record.id, record.tenantId, 'pending');
		logger.warn('[cloud-export] stale building を pending へ reclaim', {
			context: { id: record.id, tenantId: record.tenantId, exportType: record.exportType },
		});
	}
	return stale.length;
}

/**
 * pending なクラウドエクスポートを最大 limit 件 build する（#3504 async-backup-export.md §3.2）。
 * cron (`/api/cron/export-build`) が呼ぶ。AWS (cron-dispatcher) と NUC (scheduler container) の
 * 双方が同一コードパスを回す。1 件失敗しても他は継続し、失敗レコードは `status='failed'` +
 * `failureReason` を残す。
 *
 * #3509 QM 是正: build 開始前に {@link reclaimStaleBuildingExports} を呼び、cron worker が
 * kill/timeout して 'building' のまま永久 stuck したレコードを 'pending' へ差し戻してから
 * 通常の pending drain を行う。
 */
export async function drainPendingExports(limit = 5): Promise<DrainResult> {
	const repos = getRepos();
	const reclaimed = await reclaimStaleBuildingExports();
	const pending = await repos.cloudExport.findPendingBuilds(limit);
	let ready = 0;
	let failed = 0;

	for (const record of pending) {
		const { id, tenantId, exportType, s3Key } = record;
		try {
			await repos.cloudExport.updateStatus(id, tenantId, 'building');
			const artifact =
				exportType === 'template'
					? await buildTemplateExportData(tenantId)
					: await buildFullExportData(tenantId);
			await repos.storage.saveFile(s3Key, Buffer.from(artifact.bytes), artifact.contentType);
			await repos.cloudExport.updateStatus(id, tenantId, 'ready', {
				fileSizeBytes: artifact.bytes.length,
				description: artifact.description,
			});
			ready++;
			logger.info('[cloud-export] build 完了 (ready)', {
				context: { tenantId, exportType, id, size: artifact.bytes.length },
			});
		} catch (err) {
			// #3376 fail-closed: サイズ上限超過は userMessage、その他は generic なエラーメッセージを残す。
			const failureReason =
				err instanceof BackupSizeLimitError
					? err.userMessage
					: err instanceof Error
						? err.message
						: String(err);
			await repos.cloudExport.updateStatus(id, tenantId, 'failed', { failureReason });
			failed++;
			logger.error('[cloud-export] build 失敗 (failed)', {
				context: { tenantId, exportType, id },
				error: failureReason,
			});
		}
	}

	return { processed: pending.length, ready, failed, reclaimed };
}

/**
 * 自テナントのクラウドエクスポート一覧を取得（#3504: 生成中/失敗も返す）。
 * ready は DL 上限に達した / 期限切れを除外するが、pending/building/failed は生成状況を
 * UI に見せるため（期限内である限り）返す。
 */
export async function listCloudExports(tenantId: string): Promise<CloudExportRecord[]> {
	const repos = getRepos();
	const all = await repos.cloudExport.findByTenant(tenantId);
	const now = new Date().toISOString();
	return all.filter((e) => {
		if (e.expiresAt <= now) return false;
		// 既存行の NULL 安全性: status 未設定 (旧 backfill 漏れ) は 'ready' 扱い。
		const status = e.status ?? 'ready';
		if (status === 'ready') return e.downloadCount < e.maxDownloads;
		// pending / building / failed は生成状況として表示する。
		return true;
	});
}

/** クラウドエクスポートを削除 */
export async function deleteCloudExport(id: number, tenantId: string): Promise<void> {
	const repos = getRepos();
	const record = await repos.cloudExport.findById(id, tenantId);
	if (!record) throw new Error('エクスポートが見つかりません');

	// S3からも削除
	try {
		await repos.storage.deleteByPrefix(record.s3Key);
	} catch {
		// S3削除失敗はログのみ（DB側は削除する）
		logger.warn('[cloud-export] S3削除失敗', { context: { s3Key: record.s3Key } });
	}

	await repos.cloudExport.deleteById(id, tenantId);
	logger.info('[cloud-export] エクスポート削除', { context: { id, tenantId } });
}

/**
 * PINコードでクラウドエクスポートデータを取得（インポート用）。
 * #3376: full export は ZIP（バイナリ）になり得るため、raw bytes を返す
 * （template=JSON は呼び出し側で utf-8 decode、full は ZIP マジックバイトで判定して解凍）。
 *
 * **DL カウントは本関数では消費しない**（#3376 adversarial 是正）。旧実装は parse/validate より前の
 * fetch 時点で常に increment していたため、preview や validate 失敗・リトライのたびに maxDownloads を
 * 食い潰し、本来の復元 (execute) ができなくなる恐れがあった。消費は validate 成功後の execute/replace で
 * {@link consumeCloudExportDownload} を明示的に呼ぶ責務に分離する（preview は非消費）。
 */
export async function fetchCloudExportByPin(pinCode: string): Promise<{
	record: CloudExportRecord;
	bytes: Uint8Array;
}> {
	const repos = getRepos();
	const record = await repos.cloudExport.findByPin(pinCode.toUpperCase());

	if (!record) throw new Error('PINコードが無効です');
	if (new Date(record.expiresAt) < new Date())
		throw new Error('このエクスポートは有効期限切れです');
	if (record.downloadCount >= record.maxDownloads)
		throw new Error('このエクスポートはダウンロード回数の上限に達しています');

	// S3からデータ取得
	const fileData = await repos.storage.readFile(record.s3Key);
	if (!fileData) throw new Error('エクスポートデータが見つかりません');

	return { record, bytes: new Uint8Array(fileData.data) };
}

/**
 * クラウドエクスポートの DL カウントを 1 消費する（#3376 adversarial 是正）。
 * validate 成功後の実取込 (execute / replace) でのみ呼ぶ。preview では呼ばない。
 * (#2845 B1: record.tenantId で tenant 束縛して increment する)
 */
export async function consumeCloudExportDownload(record: CloudExportRecord): Promise<void> {
	const repos = getRepos();
	await repos.cloudExport.incrementDownloadCount(record.id, record.tenantId);
}

/** 期限切れエクスポートを一括削除（Cronジョブ用） */
export async function cleanupExpiredExports(): Promise<number> {
	const repos = getRepos();
	const now = new Date().toISOString();

	// 期限切れレコードを取得（S3削除用）
	// Note: findByTenant は全テナント横断できないので、deleteExpired で一括削除
	const deletedCount = await repos.cloudExport.deleteExpired(now);

	if (deletedCount > 0) {
		logger.info('[cloud-export] 期限切れエクスポート削除', { context: { deletedCount } });
	}

	return deletedCount;
}
