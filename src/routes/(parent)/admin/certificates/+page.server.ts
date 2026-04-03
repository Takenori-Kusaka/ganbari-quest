import { requireTenantId } from '$lib/server/auth/factory';
import { getCertificatesForChild } from '$lib/server/services/certificate-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);

	const [childrenWithCerts, isPremium] = await Promise.all([
		Promise.all(
			children.map(async (child) => {
				const certificates = await getCertificatesForChild(child.id, tenantId);
				return {
					id: child.id,
					nickname: child.nickname,
					certificates,
				};
			}),
		),
		resolveFullPlanTier(
			tenantId,
			locals.context?.licenseStatus ?? 'none',
			locals.context?.plan,
		).then(isPaidTier),
	]);

	return { children: childrenWithCerts, isPremium };
};
