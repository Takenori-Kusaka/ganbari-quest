import { activityPackIndex, getActivityPack } from '$lib/data/activity-packs';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	importActivities,
	previewActivityImport,
} from '$lib/server/services/activity-import-service';
import { getActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	const [children, existingActivities] = await Promise.all([
		getAllChildren(tenantId),
		getActivities(tenantId),
	]);

	const ages = children.map((c) => c.age);
	const minAge = children.length > 0 ? Math.min(...ages) : 0;
	const maxAge = children.length > 0 ? Math.max(...ages) : 18;
	const existingNames = new Set(existingActivities.map((a) => a.name));

	const packsWithStatus = activityPackIndex.packs.map((p) => {
		const full = getActivityPack(p.packId);
		const activities = full
			? full.activities.map((a) => ({
					name: a.name,
					icon: a.icon,
					categoryCode: a.categoryCode,
					basePoints: a.basePoints,
					alreadyImported: existingNames.has(a.name),
				}))
			: [];
		const importedCount = activities.filter((a) => a.alreadyImported).length;
		const isRecommended = p.targetAgeMin <= maxAge && p.targetAgeMax >= minAge;

		return {
			...p,
			activities,
			importedCount,
			isFullyImported: importedCount === activities.length,
			isRecommended,
		};
	});

	return {
		packs: packsWithStatus,
		childAgeMin: minAge,
		childAgeMax: maxAge,
	};
};

export const actions: Actions = {
	importPack: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const packId = formData.get('packId')?.toString();

		if (!packId) return fail(400, { error: 'パックIDが必要です' });

		const pack = getActivityPack(packId);
		if (!pack) return fail(404, { error: 'パックが見つかりません' });

		const preview = await previewActivityImport(pack.activities, tenantId);
		if (preview.newActivities === 0) {
			return { success: true, imported: 0, message: 'すべての活動は登録済みです' };
		}

		await importActivities(pack.activities, tenantId);
		redirect(302, '/admin/packs');
	},
};
