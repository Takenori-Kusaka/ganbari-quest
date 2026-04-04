// POST /api/v1/admin/viewer-tokens — 閲覧トークン発行
// GET  /api/v1/admin/viewer-tokens — 閲覧トークン一覧
// (#371)

import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { resolvePlanTier } from '$lib/server/services/plan-limit-service';
import { getTrialStatus } from '$lib/server/services/trial-service';
import { createViewerToken, listViewerTokens } from '$lib/server/services/viewer-token-service';
import type { RequestHandler } from './$types';

async function requireFamily(locals: App.Locals): Promise<string> {
	const tenantId = requireTenantId(locals);
	const trialStatus = await getTrialStatus(tenantId);
	const tier = resolvePlanTier(
		locals.context?.licenseStatus ?? 'none',
		locals.context?.plan,
		trialStatus.trialEndDate,
	);
	if (tier !== 'family') {
		error(403, 'ファミリープラン限定の機能です');
	}
	return tenantId;
}

export const GET: RequestHandler = async ({ locals }) => {
	const tenantId = await requireFamily(locals);
	const tokens = await listViewerTokens(tenantId);
	return json({ tokens });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const tenantId = await requireFamily(locals);
	const body = await request.json();
	const label = typeof body.label === 'string' ? body.label.slice(0, 50) : undefined;
	const duration = ['7d', '30d', 'unlimited'].includes(body.duration) ? body.duration : '30d';

	const token = await createViewerToken(tenantId, { label, duration });
	return json({ token }, { status: 201 });
};
