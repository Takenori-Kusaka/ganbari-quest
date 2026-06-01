import { getAllTags, getMarketplaceCounts, getMarketplaceIndex } from '$lib/data/marketplace';
import { getAgeTierShortLabel, type MarketplaceSortKey } from '$lib/domain/labels';
import { AGE_BANDS, type AgeBand, type MarketplaceGender } from '$lib/domain/marketplace-item';
import { logger } from '$lib/server/logger';
import { getChildById } from '$lib/server/services/child-service';
import type { PageServerLoad } from './$types';

const VALID_SORTS: readonly MarketplaceSortKey[] = ['popularity', 'newest', 'ageFit'] as const;
const VALID_GENDERS: readonly MarketplaceGender[] = ['boy', 'girl', 'neutral'] as const;

/**
 * Round 18 Cluster C: selectedChildId cookie + child.uiMode から自動 age filter を解決する。
 * - anonymous access (no auth context / no cookie) では null を返し従来挙動 (filter 未適用) を維持。
 * - tenant boundary 違反や stale cookie は silent fail し null を返す (UX 影響なし)。
 * - parse 失敗 / 非整数 cookie 値 は logger.warn で観測性確保 (QM Adversarial security 軸 推奨、Fix Round 1 B6)。
 * 戻り値: { ageBand: AgeBand id, childName: 表示名 } | null
 */
async function resolveAutoAgeFilter(
	cookies: Parameters<PageServerLoad>[0]['cookies'],
	locals: Parameters<PageServerLoad>[0]['locals'],
): Promise<{ ageBand: AgeBand; childName: string } | null> {
	const tenantId = locals.context?.tenantId;
	if (!tenantId) return null;
	const childIdStr = cookies.get('selectedChildId');
	if (!childIdStr) return null;
	const childId = Number(childIdStr);
	// Fix Round 1 B6: Number.isInteger guard で非整数・NaN・Infinity を一括 reject + logger.warn で観測性確保
	if (!Number.isInteger(childId) || childId <= 0) {
		logger.warn('[marketplace] selectedChildId cookie が不正値', {
			service: 'marketplace',
			tenantId,
			context: { childIdStrLength: childIdStr.length },
		});
		return null;
	}
	try {
		const child = await getChildById(childId, tenantId);
		if (!child?.uiMode) return null;
		const uiMode = child.uiMode as AgeBand;
		if (!AGE_BANDS.some((b) => b.id === uiMode)) return null;
		return { ageBand: uiMode, childName: child.nickname ?? '' };
	} catch (err) {
		// Fix Round 1 B6: tenant boundary 違反 / stale cookie / DB エラーを silent fail しつつ観測性確保
		logger.warn('[marketplace] selectedChildId 自動 filter 解決失敗', {
			service: 'marketplace',
			tenantId,
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

/**
 * Round 18 Cluster C: 並べ替えキーを検証し、未指定 / 不正値は popularity にフォールバック。
 * load() の cognitive complexity を抑えるため分離 (#1171 既存ロジック)。
 */
function resolveSort(sortParam: string | null): MarketplaceSortKey {
	return VALID_SORTS.includes(sortParam as MarketplaceSortKey)
		? (sortParam as MarketplaceSortKey)
		: 'popularity';
}

/**
 * Round 18 Cluster C: 性別フィルタを検証し、未指定 / 不正値は null にフォールバック。
 * load() の cognitive complexity を抑えるため分離。
 */
function resolveGender(genderParam: string | null): MarketplaceGender | null {
	return VALID_GENDERS.includes(genderParam as MarketplaceGender)
		? (genderParam as MarketplaceGender)
		: null;
}

export const load: PageServerLoad = async ({ url, cookies, locals }) => {
	const typeFilter = url.searchParams.get('type');
	const explicitAgeFilter = url.searchParams.get('age'); // AgeBand id (明示指定)
	const tagFilter = url.searchParams.get('tag');
	const genderFilter = url.searchParams.get('gender');
	const sortParam = url.searchParams.get('sort');

	// Round 18 Cluster C: age 未指定時に selectedChildId 経由で自動適用 (LP「年齢にぴったり」訴求整合)
	// `?age=` を明示指定した場合は常に override 優先 ('' 明示クリアも含む)
	const hasExplicitAge = url.searchParams.has('age');
	const autoAge = hasExplicitAge ? null : await resolveAutoAgeFilter(cookies, locals);
	const ageFilter = explicitAgeFilter || autoAge?.ageBand || null;
	const autoApplied = !explicitAgeFilter && autoAge !== null;

	const sort = resolveSort(sortParam);
	const gender = resolveGender(genderFilter);

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
		// Round 18 Cluster C: 自動適用 hint + override 動線用情報
		ageAutoApplied: autoApplied
			? {
					childName: autoAge?.childName ?? '',
					ageTierLabel: ageFilter ? getAgeTierShortLabel(ageFilter) : '',
				}
			: null,
	};
};
