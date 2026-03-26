import { requireTenantId } from '$lib/server/auth/factory';
import { getActivities } from '$lib/server/services/activity-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const activities = await getActivities(tenantId, { includeHidden: false });
	return { activities };
};
