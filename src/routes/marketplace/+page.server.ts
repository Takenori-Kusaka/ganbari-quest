import { getAllTags, getMarketplaceCounts, getMarketplaceIndex } from '$lib/data/marketplace';
import { getAgeTierShortLabel, type MarketplaceSortKey } from '$lib/domain/labels';
import { AGE_BANDS, type AgeBand, type MarketplaceGender } from '$lib/domain/marketplace-item';
import { isBrowseableMarketplaceType, MARKETPLACE_BROWSE_TYPE_CODES } from '$lib/marketplace/types';
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

/**
 * #2896: type フィルタを陳列対象 (MARKETPLACE_BROWSE_TYPE_CODES) に限定する。
 * 陳列外 type (rule-preset / challenge-set) の `?type=` は無視して null を返す。
 * load() の cognitive complexity を抑えるため分離。
 */
function resolveBrowseTypeFilter(typeParam: string | null): string | null {
	return typeParam && isBrowseableMarketplaceType(typeParam) ? typeParam : null;
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

	// #2896: marketplace は活動 / ごほうび / チェックリストの 3 type に絞る。
	// 陳列 surface (一覧 / type filter / 件数) は MARKETPLACE_BROWSE_TYPE_CODES を SSOT として filter する。
	// rule-preset / challenge-set は型 / 直リンク / admin の ?import= 互換のため Registry には残すが、
	// この一覧には載せない (陳列対象外)。
	let items = getMarketplaceIndex().filter((i) => isBrowseableMarketplaceType(i.type));

	// 陳列対象 type のみを有効な type filter として扱う (陳列外 type の ?type= は無視)。
	const activeTypeFilter = resolveBrowseTypeFilter(typeFilter);
	if (activeTypeFilter) {
		items = items.filter((i) => i.type === activeTypeFilter);
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
		// #2900: 認証済み (locals.context あり) なら header に「← 見守り画面へ」戻り導線を出す。
		// marketplace は未認証でも閲覧可能な公開ルートのため、未認証時は false で導線を非表示にする
		// (browse-first journey の dead-end を解消しつつ公開ページ性を維持)。
		isAuthenticated: !!locals.context,
		items,
		// #2896: tag cloud も陳列対象 3 type の item に出現する tag のみに絞る。
		tags: getAllTags(MARKETPLACE_BROWSE_TYPE_CODES),
		// #2896: 件数も陳列対象 3 type に絞って返す (陳列外 type のカードを出さない)。
		counts: Object.fromEntries(
			MARKETPLACE_BROWSE_TYPE_CODES.map((code) => [code, getMarketplaceCounts()[code]]),
		) as Record<(typeof MARKETPLACE_BROWSE_TYPE_CODES)[number], number>,
		ageBands: AGE_BANDS.map((b) => ({ id: b.id as AgeBand, label: b.label })),
		filters: {
			type: activeTypeFilter,
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
