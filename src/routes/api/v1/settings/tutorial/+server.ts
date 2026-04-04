import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { setSetting } from '$lib/server/db/settings-repo';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const tenantId = requireTenantId(locals);
	const body = await request.json();
	const action = body.action as string;

	const now = new Date().toISOString();

	switch (action) {
		case 'start':
			await setSetting('tutorial_started_at', now, tenantId);
			break;
		case 'complete':
			await setSetting('tutorial_completed_at', now, tenantId);
			break;
		case 'dismiss':
			await setSetting('tutorial_banner_dismissed', 'true', tenantId);
			break;
		default:
			throw error(400, 'Invalid action');
	}

	return json({ ok: true });
};
