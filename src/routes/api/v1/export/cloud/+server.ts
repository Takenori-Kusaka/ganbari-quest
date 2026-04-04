// src/routes/api/v1/export/cloud/+server.ts
// クラウドエクスポートAPI（一覧取得 + 新規作成）

import { json } from '@sveltejs/kit';
import { requireRole, requireTenantId } from '$lib/server/auth/factory';
import type { CloudExportType } from '$lib/server/db/types';
import { apiError, validationError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { createCloudExport, listCloudExports } from '$lib/server/services/cloud-export-service';
import type { RequestHandler } from './$types';

/** GET /api/v1/export/cloud — 自テナントのクラウドエクスポート一覧 */
export const GET: RequestHandler = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	requireRole(locals, ['owner', 'parent']);

	try {
		const exports = await listCloudExports(tenantId);
		return json({ ok: true, exports });
	} catch (err) {
		logger.error('[cloud-export] 一覧取得失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', 'クラウドエクスポート一覧の取得に失敗しました');
	}
};

/** POST /api/v1/export/cloud — クラウドエクスポート作成 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const tenantId = requireTenantId(locals);
	requireRole(locals, ['owner', 'parent']);

	let body: { exportType?: string; label?: string };
	try {
		body = await request.json();
	} catch {
		return validationError('JSONの解析に失敗しました');
	}

	const exportType = body.exportType;
	if (exportType !== 'template' && exportType !== 'full') {
		return validationError('exportType は template または full を指定してください');
	}

	const licenseStatus = locals.context?.licenseStatus ?? 'none';
	const planId = locals.context?.plan;

	try {
		const result = await createCloudExport({
			tenantId,
			exportType: exportType as CloudExportType,
			label: body.label,
			licenseStatus,
			planId,
		});
		return json({ ok: true, ...result }, { status: 201 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('有料プラン') || msg.includes('上限')) {
			return apiError('PLAN_LIMIT_EXCEEDED', msg);
		}
		if (msg.includes('SaaS版')) {
			return apiError('VALIDATION_ERROR', msg);
		}
		logger.error('[cloud-export] 作成失敗', { error: msg });
		return apiError('INTERNAL_ERROR', 'クラウドエクスポートの作成に失敗しました');
	}
};
