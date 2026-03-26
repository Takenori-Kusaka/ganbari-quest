import { requireTenantId } from '$lib/server/auth/factory';
import { getBirthdayReviews } from '$lib/server/services/birthday-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { reviews: [] };

	const reviews = await getBirthdayReviews(child.id, tenantId);
	return { reviews };
};
