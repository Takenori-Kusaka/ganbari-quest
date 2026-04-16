// POST /api/v1/admin/downgrade-restore — アーカイブ済みリソースの復元 (#738)

import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { requireRole } from '$lib/server/auth/guards';
import { logger } from '$lib/server/logger';
import { restoreArchivedResources } from '$lib/server/services/resource-archive-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	requireRole(locals, ['owner', 'parent']);
	const tenantId = requireTenantId(locals);

	await restoreArchivedResources(tenantId);

	logger.info('[DOWNGRADE-RESTORE] Archived resources restored', {
		context: { tenantId },
	});

	return json({ ok: true });
};
