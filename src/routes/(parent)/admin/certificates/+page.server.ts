import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { requireTenantId } from '$lib/server/auth/factory';
import { getCertificatesForChild } from '$lib/server/services/certificate-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// ADR-0039 Phase 2 (#2097): デモ実行モード時は demo data。
	if (locals.isDemo) {
		const { DEMO_CHILDREN: demoChildren } = await import('$lib/server/demo/demo-data');
		return {
			children: demoChildren.map((c) => ({ id: c.id, nickname: c.nickname, certificates: [] })),
			isPremium: false,
		};
	}

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
			locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
			locals.context?.plan,
		).then(isPaidTier),
	]);

	return { children: childrenWithCerts, isPremium };
};
