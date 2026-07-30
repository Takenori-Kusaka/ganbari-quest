import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { jstYearMonth } from '$lib/domain/date-utils';
import { asChildId } from '$lib/domain/ids';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import { buildGrowthBook } from '$lib/server/services/growth-book-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

// 年度判定は JST SSOT 経由 (#4015)。ローカル getter だと Lambda (UTC) で
// 4/1 の JST 00:00〜09:00 に年度が 1 年ずれる。
function currentFiscalYear(): string {
	const { year, month } = jstYearMonth();
	return String(month >= 4 ? year : year - 1);
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		return { children: [], book: null, isPremium: false, fiscalYear: currentFiscalYear() };
	}

	const fiscalYear = url.searchParams.get('year') ?? currentFiscalYear();
	const childIdParam = url.searchParams.get('childId');
	const selectedChildId = childIdParam
		? asChildId(childIdParam)
		: (children[0]?.id ?? asChildId(''));

	const [book, isPremium] = await Promise.all([
		buildGrowthBook(selectedChildId, fiscalYear, tenantId),
		resolveFullPlanTier(
			tenantId,
			locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
			locals.context?.plan,
		).then(isPaidTier),
	]);

	return {
		children: children.map((c) => ({ id: c.id, nickname: c.nickname })),
		book,
		isPremium,
		fiscalYear,
	};
};
