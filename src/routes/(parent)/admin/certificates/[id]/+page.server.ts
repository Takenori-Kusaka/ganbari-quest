import { error } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
// #4512: エラー文言は labels SSOT 経由 (docs/DESIGN.md §6 / ADR-0045)
import { ADMIN_FORM_ERROR_LABELS, CERTIFICATE_DETAIL_LABELS } from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import { buildRenderData, getCertificateDetail } from '$lib/server/services/certificate-service';
import { getChildById } from '$lib/server/services/child-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	const certId = params.id;
	if (!certId) error(404, CERTIFICATE_DETAIL_LABELS.certificateNotFound);

	const cert = await getCertificateDetail(certId, tenantId);
	if (!cert) error(404, CERTIFICATE_DETAIL_LABELS.certificateNotFound);

	const child = await getChildById(cert.childId, tenantId);
	if (!child) error(404, ADMIN_FORM_ERROR_LABELS.childNotFoundNeutral);

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
