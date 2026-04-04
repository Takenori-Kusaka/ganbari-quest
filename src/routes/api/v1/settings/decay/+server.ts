import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import type { RequestHandler } from './$types';

const VALID_INTENSITIES = ['none', 'gentle', 'normal', 'strict'] as const;

/** 減少強度設定を取得 */
export const GET: RequestHandler = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const value = await getSetting('decay_intensity', tenantId);
	return json({ intensity: value ?? 'normal' });
};

/** 減少強度設定を更新 */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const tenantId = requireTenantId(locals);
	const body = await request.json();
	const intensity = body.intensity as string;

	if (!VALID_INTENSITIES.includes(intensity as (typeof VALID_INTENSITIES)[number])) {
		throw error(400, `Invalid intensity. Must be one of: ${VALID_INTENSITIES.join(', ')}`);
	}

	await setSetting('decay_intensity', intensity, tenantId);
	return json({ ok: true, intensity });
};
