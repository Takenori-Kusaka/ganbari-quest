import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);

	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	const imported = Number(url.searchParams.get('imported') ?? 0);
	const skipped = Number(url.searchParams.get('skipped') ?? 0);

	trackSetupFunnel('setup_completed', tenantId, {
		childCount: children.length,
		imported,
	});

	return {
		childCount: children.length,
		children,
		importedActivities: imported,
		skippedActivities: skipped,
	};
};
