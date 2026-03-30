import { requireTenantId } from '$lib/server/auth/factory';
import { getSetting } from '$lib/server/db/settings-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);
	// Guard: setup not complete -> redirect back
	const pinHash = await getSetting('pin_hash', tenantId);
	const children = await getAllChildren(tenantId);

	if (!pinHash) {
		redirect(302, '/setup');
	}
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	return { childCount: children.length };
};
