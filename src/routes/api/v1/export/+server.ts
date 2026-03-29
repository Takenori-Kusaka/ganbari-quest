// src/routes/api/v1/export/+server.ts
// 家族データエクスポートAPI（JSON / ZIP対応）

import { requireRole, requireTenantId } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { exportFamilyData } from '$lib/server/services/export-service';
import { getPlanLimits, resolvePlanTier } from '$lib/server/services/plan-limit-service';
import { listFiles, readFile } from '$lib/server/storage';
import { tenantPrefix } from '$lib/server/storage-keys';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const tenantId = requireTenantId(locals);
	requireRole(locals, ['owner', 'parent']);

	// プラン制限チェック（エクスポート機能）
	const licenseStatus = locals.context?.licenseStatus ?? 'none';
	const limits = getPlanLimits(resolvePlanTier(licenseStatus));
	if (!limits.canExport) {
		return apiError(
			'PLAN_LIMIT_EXCEEDED',
			'エクスポート機能はプレミアムプランでご利用いただけます',
		);
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
		const now = new Date().toISOString().slice(0, 10);

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

async function buildZipResponse(
	exportData: unknown,
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
				totalSize += fileData.data.length;
			}
		}
	} catch (err) {
		logger.warn('[export] 静的ファイル取得に失敗（JSONのみでエクスポート）', {
			error: String(err),
		});
	}

	const zipData = zipSync(files);

	return new Response(zipData.buffer as ArrayBuffer, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="ganbari-quest-backup-${dateStr}.zip"`,
			'Cache-Control': 'no-cache, no-store, must-revalidate',
		},
	});
}
