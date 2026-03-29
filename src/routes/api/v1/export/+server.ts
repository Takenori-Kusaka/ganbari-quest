// src/routes/api/v1/export/+server.ts
// 家族データエクスポートAPI

import { requireRole, requireTenantId } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { exportFamilyData } from '$lib/server/services/export-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const tenantId = requireTenantId(locals);
	requireRole(locals, ['owner', 'parent']);

	const childIdsParam = url.searchParams.get('childIds');
	const childIds = childIdsParam
		? childIdsParam
				.split(',')
				.map(Number)
				.filter((n) => !Number.isNaN(n))
		: undefined;
	const compact = url.searchParams.get('compact') === '1';

	try {
		const exportData = await exportFamilyData({ tenantId, childIds, compact });
		const jsonStr = compact ? JSON.stringify(exportData) : JSON.stringify(exportData, null, 2);
		const now = new Date().toISOString().split('T')[0];

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
