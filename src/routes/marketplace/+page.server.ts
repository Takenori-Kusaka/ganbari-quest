import { getAllTags, getMarketplaceCounts, getMarketplaceIndex } from '$lib/data/marketplace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const typeFilter = url.searchParams.get('type');
	const ageFilter = url.searchParams.get('age');
	const tagFilter = url.searchParams.get('tag');

	let items = getMarketplaceIndex();

	if (typeFilter) {
		items = items.filter((i) => i.type === typeFilter);
	}
	if (ageFilter) {
		const age = Number(ageFilter);
		if (!Number.isNaN(age)) {
			items = items.filter((i) => i.targetAgeMin <= age && i.targetAgeMax >= age);
		}
	}
	if (tagFilter) {
		items = items.filter((i) => i.tags.includes(tagFilter));
	}

	return {
		items,
		tags: getAllTags(),
		counts: getMarketplaceCounts(),
		filters: {
			type: typeFilter,
			age: ageFilter,
			tag: tagFilter,
		},
	};
};
