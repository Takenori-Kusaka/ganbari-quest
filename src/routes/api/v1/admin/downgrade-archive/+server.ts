// POST /api/v1/admin/downgrade-archive — ダウングレード用リソースアーカイブ (#738)

import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { requireRole } from '$lib/server/auth/guards';
import { logger } from '$lib/server/logger';
import { archiveForDowngrade } from '$lib/server/services/downgrade-service';
import type { PlanTier } from '$lib/server/services/plan-limit-service';
import type { RequestHandler } from './$types';

const VALID_TIERS: PlanTier[] = ['free', 'standard', 'family'];

export const POST: RequestHandler = async ({ locals, request }) => {
	requireRole(locals, ['owner', 'parent']);
	const tenantId = requireTenantId(locals);

	const body = await request.json();
	const { targetTier, childIds, activityIds, checklistTemplateIds } = body as {
		targetTier?: string;
		childIds?: number[];
		activityIds?: number[];
		checklistTemplateIds?: number[];
	};

	if (!targetTier || !VALID_TIERS.includes(targetTier as PlanTier)) {
		error(400, 'targetTier は free / standard / family のいずれかを指定してください');
	}

	if (
		!Array.isArray(childIds) ||
		!Array.isArray(activityIds) ||
		!Array.isArray(checklistTemplateIds)
	) {
		error(400, 'childIds, activityIds, checklistTemplateIds は配列で指定してください');
	}

	const result = await archiveForDowngrade(tenantId, targetTier as PlanTier, {
		childIds: childIds ?? [],
		activityIds: activityIds ?? [],
		checklistTemplateIds: checklistTemplateIds ?? [],
	});

	if (!result.ok) {
		logger.warn('[DOWNGRADE-ARCHIVE] Validation failed', {
			context: { tenantId, reason: result.reason },
		});
		error(400, result.reason);
	}

	logger.info('[DOWNGRADE-ARCHIVE] Resources archived for downgrade', {
		context: {
			tenantId,
			targetTier,
			childIds: childIds.length,
			activityIds: activityIds.length,
			checklistTemplateIds: checklistTemplateIds.length,
		},
	});

	return json({
		ok: true,
		archivedChildIds: result.archivedChildIds,
		archivedActivityIds: result.archivedActivityIds,
		archivedChecklistTemplateIds: result.archivedChecklistTemplateIds,
	});
};
