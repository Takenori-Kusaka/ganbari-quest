import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import { buildGrowthBook } from '$lib/server/services/growth-book-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

function currentFiscalYear(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = now.getMonth() + 1;
	return String(m >= 4 ? y : y - 1);
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		return { children: [], book: null, isPremium: false, fiscalYear: currentFiscalYear() };
	}

	const fiscalYear = url.searchParams.get('year') ?? currentFiscalYear();
	const childIdParam = url.searchParams.get('childId');
	const selectedChildId = childIdParam ? Number(childIdParam) : (children[0]?.id ?? 0);

	const [book, isPremium] = await Promise.all([
		buildGrowthBook(selectedChildId, fiscalYear, tenantId),
		resolveFullPlanTier(
			tenantId,
			locals.context?.licenseStatus ?? 'none',
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
