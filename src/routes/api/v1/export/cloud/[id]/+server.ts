// src/routes/api/v1/export/cloud/[id]/+server.ts
// クラウドエクスポート個別操作API（削除）

import { requireRole, requireTenantId } from '$lib/server/auth/factory';
import { apiError, validationError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { deleteCloudExport } from '$lib/server/services/cloud-export-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** DELETE /api/v1/export/cloud/:id — クラウドエクスポート削除 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	requireRole(locals, ['owner', 'parent']);

	const id = Number(params.id);
	if (Number.isNaN(id) || id <= 0) {
		return validationError('無効なIDです');
	}

	try {
		await deleteCloudExport(id, tenantId);
		return json({ ok: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('見つかりません')) {
			return apiError('NOT_FOUND', msg);
		}
		logger.error('[cloud-export] 削除失敗', { error: msg });
		return apiError('INTERNAL_ERROR', 'クラウドエクスポートの削除に失敗しました');
	}
};
