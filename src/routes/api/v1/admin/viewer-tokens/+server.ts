// POST /api/v1/admin/viewer-tokens — 閲覧トークン発行
// GET  /api/v1/admin/viewer-tokens — 閲覧トークン一覧
// (#371)

import { error, json } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { createViewerToken, listViewerTokens } from '$lib/server/services/viewer-token-service';
import type { RequestHandler } from './$types';

async function requireFamily(locals: App.Locals): Promise<string> {
	const context = locals.context;
	if (!context) {
		throw error(401, '認証が必要です');
	}
	const tenantId = context.tenantId;
	const tier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	if (tier !== 'family') {
		throw error(403, { message: 'ファミリープラン限定の機能です' });
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

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ message: '不正なJSONです' }, { status: 400 });
	}

	const label = typeof body.label === 'string' ? body.label.slice(0, 50) : undefined;
	const validDurations = ['7d', '30d', 'unlimited'] as const;
	type Duration = (typeof validDurations)[number];
	const duration: Duration = validDurations.includes(body.duration as Duration)
		? (body.duration as Duration)
		: '30d';

	const token = await createViewerToken(tenantId, { label, duration });
	return json({ token }, { status: 201 });
};
