import { getChildStatus } from '$lib/server/services/status-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { status: null };

	const result = getChildStatus(child.id);
	if ('error' in result) return { status: null };

	return { status: result };
};
