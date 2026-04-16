import { error } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { requireTenantId } from '$lib/server/auth/factory';
import { buildRenderData, getCertificateDetail } from '$lib/server/services/certificate-service';
import { getChildById } from '$lib/server/services/child-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	const certId = Number(params.id);
	if (!certId) error(404, '証明書が見つかりません');

	const cert = await getCertificateDetail(certId, tenantId);
	if (!cert) error(404, '証明書が見つかりません');

	const child = await getChildById(cert.childId, tenantId);
	if (!child) error(404, '子供が見つかりません');

	const renderData = buildRenderData(cert, child.nickname);

	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const isPremium = isPaidTier(
		await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan),
	);

	return {
		certificate: renderData,
		isPremium,
	};
};
