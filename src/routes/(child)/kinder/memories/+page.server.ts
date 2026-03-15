import { getBirthdayReviews } from '$lib/server/services/birthday-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { reviews: [] };

	const reviews = getBirthdayReviews(child.id);
	return { reviews };
};
