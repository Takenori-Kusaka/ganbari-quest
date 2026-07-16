// src/routes/api/v1/export/+server.ts
// 家族データエクスポートAPI（JSON / ZIP対応）

import { json } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { todayDateJST } from '$lib/domain/date-utils';
import type { ExportData } from '$lib/domain/export-format';
import { asChildId } from '$lib/domain/ids';
import { PLAN_GATE_LABELS, SETTINGS_LABELS } from '$lib/domain/labels';
import { requireRole } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { BackupSizeLimitError, buildFullBackupZip } from '$lib/server/services/backup-archive';
import { exportFamilyData } from '$lib/server/services/export-service';
import { resolveMaxSyncResponseBytes } from '$lib/server/services/function-url-limit';
import { toDisplayMb } from '$lib/server/services/import-limit';
import { getPlanLimits, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
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
				.map((v) => v.trim())
				.filter((v) => v !== '')
				.map(asChildId)
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
		// #3376 fail-closed: 同梱対象が上限超過のとき、不完全な部分バックアップを返さずユーザーに明示する。
		if (err instanceof BackupSizeLimitError) {
			return apiError('VALIDATION_ERROR', err.userMessage);
		}
		logger.error('[export] エクスポート失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', 'エクスポートに失敗しました');
	}
};

/**
 * 全体バックアップ ZIP をレスポンスにして返す。ZIP 構築 (data.json + 静的ファイル + manifest +
 * per-entry 圧縮) は #3376 で `backup-archive.buildFullBackupZip` に共通化済 (ローカル DL と
 * クラウド full export で同一形式を共有)。
 */
async function buildZipResponse(
	exportData: ExportData,
	tenantId: string,
	dateStr: string,
	compact: boolean,
): Promise<Response> {
	const zipData = await buildFullBackupZip(tenantId, exportData, compact);

	// #3694: AWS 本番の Function URL (BUFFERED) は response も 6MB hard cap。構築 ZIP が実効上限
	// (MAX_ZIP_SIZE=100MB は request/response の platform cap と別) を超えると edge で沈黙切断され
	// 「ダウンロード不能」になるため、明示エラー + クラウド共有 (非同期・上限なし) へ誘導する。
	// NUC / local は resolveMaxSyncResponseBytes が Infinity を返すため従来通り直 DL を許可する。
	const maxResponseBytes = resolveMaxSyncResponseBytes();
	if (zipData.byteLength > maxResponseBytes) {
		return apiError(
			'VALIDATION_ERROR',
			SETTINGS_LABELS.dataExportTooLargeForDirectDownload(String(toDisplayMb(maxResponseBytes))),
			{ bytes: zipData.byteLength, maxBytes: maxResponseBytes },
		);
	}

	return new Response(zipData.buffer as ArrayBuffer, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="ganbari-quest-backup-${dateStr}.zip"`,
			'Cache-Control': 'no-cache, no-store, must-revalidate',
		},
	});
}
