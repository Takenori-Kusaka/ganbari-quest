import { getActivityPack } from '$lib/data/activity-packs';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const pack = getActivityPack(params.packId);
	if (!pack) {
		error(404, 'パックが見つかりません');
	}

	return { pack };
};
