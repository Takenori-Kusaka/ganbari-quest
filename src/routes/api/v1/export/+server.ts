// src/routes/api/v1/export/+server.ts
// 家族データエクスポートAPI（JSON / ZIP対応）
import { json } from '@sveltejs/kit';

import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { todayDateJST } from '$lib/domain/date-utils';
import type { ExportData } from '$lib/domain/export-format';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { requireRole } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import {
	BACKUP_MANIFEST_FILENAME,
	buildBackupManifest,
} from '$lib/server/services/backup-manifest';
import { exportFamilyData } from '$lib/server/services/export-service';
import { getPlanLimits, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { listFiles, readFile } from '$lib/server/storage';
import { tenantPrefix } from '$lib/server/storage-keys';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	requireRole(locals, ['owner', 'parent']);

	// プラン制限チェック（エクスポート機能）
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const limits = getPlanLimits(
		await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan),
	);
	if (!limits.canExport) {
		return apiError('PLAN_LIMIT_EXCEEDED', PLAN_GATE_LABELS.standardOrAboveFor('エクスポート機能'));
	}

	const childIdsParam = url.searchParams.get('childIds');
	const childIds = childIdsParam
		? childIdsParam
				.split(',')
				.map(Number)
				.filter((n) => !Number.isNaN(n))
		: undefined;
	const compact = url.searchParams.get('compact') === '1';
	const format = url.searchParams.get('format') ?? 'json';

	try {
		const exportData = await exportFamilyData({ tenantId, childIds, compact });
		const now = todayDateJST();

		if (format === 'zip') {
			return await buildZipResponse(exportData, tenantId, now, compact);
		}

		const jsonStr = compact ? JSON.stringify(exportData) : JSON.stringify(exportData, null, 2);
		return new Response(jsonStr, {
			status: 200,
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'Content-Disposition': `attachment; filename="ganbari-quest-backup-${now}.json"`,
				'Cache-Control': 'no-cache, no-store, must-revalidate',
			},
		});
	} catch (err) {
		logger.error('[export] エクスポート失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', 'エクスポートに失敗しました');
	}
};

const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * #3375: ExportData から主要エンティティ件数を数える (manifest の sanity check 用)。
 * 破損・部分欠損したバックアップを import 前に検出する補助情報。
 */
function countExportItems(exportData: ExportData): Record<string, number> {
	const d = exportData.data;
	return {
		children: exportData.family.children.length,
		childActivities: d.childActivities.length,
		activityLogs: d.activityLogs.length,
		pointLedger: d.pointLedger.length,
		specialRewards: d.specialRewards.length,
		checklistTemplates: d.checklistTemplates.length,
		checklistLogs: d.checklistLogs.length,
	};
}

async function buildZipResponse(
	exportData: ExportData,
	tenantId: string,
	dateStr: string,
	compact: boolean,
): Promise<Response> {
	const { zipSync, strToU8 } = await import('fflate');

	const files: Record<string, Uint8Array> = {};

	// 1. data.json
	const jsonStr = compact ? JSON.stringify(exportData) : JSON.stringify(exportData, null, 2);
	files['data.json'] = strToU8(jsonStr);

	let totalSize = files['data.json'].length;

	// 2. 静的ファイル（S3/ローカルストレージ）
	// #3375: 画像は既圧縮 (png/webp/jpeg) で再圧縮が効かないため per-entry で store (level 0)、
	// 構造化データ (data.json / manifest.json) のみ deflate にするためパス集合を控える。
	const staticPaths = new Set<string>();
	try {
		const prefix = tenantPrefix(tenantId);
		const fileKeys = await listFiles(prefix);

		for (const key of fileKeys) {
			if (totalSize >= MAX_ZIP_SIZE) {
				logger.warn('[export] ZIP サイズ上限に到達、残りファイルをスキップ', {
					context: { tenantId, totalSize },
				});
				break;
			}

			const fileData = await readFile(key);
			if (fileData) {
				// tenants/{tenantId}/avatars/1/xxx.png → avatars/1/xxx.png
				const relativePath = key.replace(prefix, '');
				files[relativePath] = new Uint8Array(fileData.data);
				staticPaths.add(relativePath);
				totalSize += fileData.data.length;
			}
		}
	} catch (err) {
		logger.warn('[export] 静的ファイル取得に失敗（JSONのみでエクスポート）', {
			error: String(err),
		});
	}

	// 3. #3375: 整合性 manifest（data.json + 全静的ファイルの SHA-256 + バイト数 + 件数）。
	// data.json の論理 checksum (ExportData.checksum) では守れない同梱バイナリの破損を検出可能にする。
	const manifest = await buildBackupManifest(
		files,
		exportData.version,
		countExportItems(exportData),
		new Date().toISOString(),
	);
	files[BACKUP_MANIFEST_FILENAME] = strToU8(JSON.stringify(manifest));

	// #3375: per-entry 圧縮制御。静的ファイル (既圧縮画像) は store(level 0)、
	// 構造化データ (data.json / manifest.json) は deflate(level 6)。
	const zipEntries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
	for (const [path, bytes] of Object.entries(files)) {
		zipEntries[path] = [bytes, { level: staticPaths.has(path) ? 0 : 6 }];
	}
	const zipData = zipSync(zipEntries);

	return new Response(zipData.buffer as ArrayBuffer, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="ganbari-quest-backup-${dateStr}.zip"`,
			'Cache-Control': 'no-cache, no-store, must-revalidate',
		},
	});
}
