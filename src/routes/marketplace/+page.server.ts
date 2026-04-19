import { getAllTags, getMarketplaceCounts, getMarketplaceIndex } from '$lib/data/marketplace';
import type { MarketplaceSortKey } from '$lib/domain/labels';
import { AGE_BANDS, type AgeBand, type MarketplaceGender } from '$lib/domain/marketplace-item';
import type { PageServerLoad } from './$types';

const VALID_SORTS: readonly MarketplaceSortKey[] = ['popularity', 'newest', 'ageFit'] as const;
const VALID_GENDERS: readonly MarketplaceGender[] = ['boy', 'girl', 'neutral'] as const;

export const load: PageServerLoad = async ({ url }) => {
	const typeFilter = url.searchParams.get('type');
	const ageFilter = url.searchParams.get('age'); // AgeBand id
	const tagFilter = url.searchParams.get('tag');
	const genderFilter = url.searchParams.get('gender');
	const sortParam = url.searchParams.get('sort');

	// #1171: ソート種別の検証。不正値は popularity にフォールバック。
	const sort: MarketplaceSortKey = VALID_SORTS.includes(sortParam as MarketplaceSortKey)
		? (sortParam as MarketplaceSortKey)
		: 'popularity';

	const gender: MarketplaceGender | null = VALID_GENDERS.includes(genderFilter as MarketplaceGender)
		? (genderFilter as MarketplaceGender)
		: null;

	let items = getMarketplaceIndex();

	if (typeFilter) {
		items = items.filter((i) => i.type === typeFilter);
	}

	if (ageFilter) {
		// #1171: AgeBand の id (baby/preschool/elementary/junior/senior) で絞り込み。
		const band = AGE_BANDS.find((b) => b.id === ageFilter);
		if (band) {
			items = items.filter((i) => i.targetAgeMin <= band.max && i.targetAgeMax >= band.min);
		} else {
			// 旧クエリ互換: 数値を直接渡されたら従来通り 1 歳ぶんの包含チェック。
			const age = Number(ageFilter);
			if (!Number.isNaN(age)) {
				items = items.filter((i) => i.targetAgeMin <= age && i.targetAgeMax >= age);
			}
		}
	}

	if (tagFilter) {
		items = items.filter((i) => i.tags.includes(tagFilter));
	}

	if (gender) {
		// neutral は常にヒット。男女指定時は neutral も含めて返す（除外しすぎを防ぐ）。
		items = items.filter((i) => i.gender === gender || i.gender === 'neutral');
	}

	// #1171: 並び替え
	if (sort === 'newest') {
		items = [...items].reverse();
	} else if (sort === 'ageFit') {
		items = [...items].sort((a, b) => a.targetAgeMin - b.targetAgeMin);
	} else {
		// popularity: itemCount + persona/tag の広さを指標とする（実データが無いため近似）
		items = [...items].sort(
			(a, b) =>
				b.itemCount +
				b.tags.length +
				b.personas.length -
				(a.itemCount + a.tags.length + a.personas.length),
		);
	}

	return {
		items,
		tags: getAllTags(),
		counts: getMarketplaceCounts(),
		ageBands: AGE_BANDS.map((b) => ({ id: b.id as AgeBand, label: b.label })),
		filters: {
			type: typeFilter,
			age: ageFilter,
			tag: tagFilter,
			gender,
			sort,
		},
	};
};
