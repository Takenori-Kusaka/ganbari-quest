import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import { generateReportsForChildren } from '$lib/server/services/weekly-report-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);

	const childList = children.map((c) => ({ id: c.id, nickname: c.nickname }));
	const reports = await generateReportsForChildren(childList, tenantId);

	return { reports };
};
