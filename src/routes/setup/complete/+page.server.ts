import { getSetting } from '$lib/server/db/settings-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	// Guard: setup not complete -> redirect back
	const pinHash = getSetting('pin_hash');
	const children = getAllChildren();

	if (!pinHash) {
		redirect(302, '/setup');
	}
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	return { childCount: children.length };
};
