// GET /api/v1/admin/downgrade-preview?targetTier=free — ダウングレードプレビュー (#738)

import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { requireRole } from '$lib/server/auth/guards';
import { getDowngradePreview } from '$lib/server/services/downgrade-service';
import type { PlanTier } from '$lib/server/services/plan-limit-service';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { RequestHandler } from './$types';

const VALID_TIERS: PlanTier[] = ['free', 'standard', 'family'];

export const GET: RequestHandler = async ({ locals, url }) => {
	requireRole(locals, ['owner', 'parent']);
	const tenantId = requireTenantId(locals);

	const targetTier = url.searchParams.get('targetTier');
	if (!targetTier || !VALID_TIERS.includes(targetTier as PlanTier)) {
		error(400, 'targetTier は free / standard / family のいずれかを指定してください');
	}

	const currentTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? 'none',
		locals.context?.plan,
	);

	const preview = await getDowngradePreview(tenantId, currentTier, targetTier as PlanTier);
	return json(preview);
};
