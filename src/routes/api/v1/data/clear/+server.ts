// src/routes/api/v1/data/clear/+server.ts
// テナントデータクリア API (#0205)

import { requireRole, requireTenantId } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { clearAllFamilyData } from '$lib/server/services/data-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** POST /api/v1/data/clear */
export const POST: RequestHandler = async ({ request, locals }) => {
	const tenantId = requireTenantId(locals);
	requireRole(locals, ['owner']);

	let body: { confirm?: string };
	try {
		body = await request.json();
	} catch {
		return apiError('VALIDATION_ERROR', 'JSONの解析に失敗しました');
	}

	if (body.confirm !== '削除') {
		return apiError('VALIDATION_ERROR', '確認テキスト「削除」が必要です');
	}

	try {
		const result = await clearAllFamilyData(tenantId);
		logger.info(`[data-clear] テナント ${tenantId} のデータクリア完了`);
		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('[data-clear] データクリア失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', 'データクリアに失敗しました');
	}
};
