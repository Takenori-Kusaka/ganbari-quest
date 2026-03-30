// src/routes/api/v1/import/+server.ts
// 家族データインポートAPI

import { requireRole, requireTenantId } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { clearAllFamilyData } from '$lib/server/services/data-service';
import {
	importFamilyData,
	previewImport,
	validateExportData,
} from '$lib/server/services/import-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** POST /api/v1/import?mode=preview|execute|replace */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const tenantId = requireTenantId(locals);
	requireRole(locals, ['owner', 'parent']);

	const mode = url.searchParams.get('mode') ?? 'preview';

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError('VALIDATION_ERROR', 'JSONの解析に失敗しました');
	}

	const validation = validateExportData(body);
	if (!validation.valid) {
		return apiError('VALIDATION_ERROR', validation.error);
	}

	if (mode === 'preview') {
		const preview = previewImport(validation.data);
		return json({ ok: true, preview });
	}

	if (mode === 'execute') {
		try {
			const result = await importFamilyData(validation.data, tenantId);
			return json({ ok: true, result });
		} catch (err) {
			logger.error('[import] インポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', 'インポートに失敗しました');
		}
	}

	if (mode === 'replace') {
		requireRole(locals, ['owner', 'parent']);
		try {
			logger.info('[import] 置換インポート開始: データクリア実行', { context: { tenantId } });
			const clearResult = await clearAllFamilyData(tenantId);
			logger.info('[import] データクリア完了、インポート開始');
			const result = await importFamilyData(validation.data, tenantId);
			return json({ ok: true, result, cleared: clearResult.deleted });
		} catch (err) {
			logger.error('[import] 置換インポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', '置換インポートに失敗しました');
		}
	}

	return apiError('VALIDATION_ERROR', 'mode は preview, execute, replace を指定してください');
};
