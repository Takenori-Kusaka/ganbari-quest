import { fail, redirect } from '@sveltejs/kit';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import type { ActivityPackItem } from '$lib/domain/activity-pack';
import type { ActivityPackPayload } from '$lib/domain/marketplace-item';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	importActivities,
	previewActivityImport,
} from '$lib/server/services/activity-import-service';
import { getActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';
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

	const activityPackMetas = getMarketplaceIndex().filter((m) => m.type === 'activity-pack');
	const packsWithStatus = activityPackMetas.map((p) => {
		const full = getMarketplaceItem('activity-pack', p.itemId);
		const payload = full?.payload as ActivityPackPayload | undefined;
		const activities = payload
			? payload.activities.map((a) => ({
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
			packId: p.itemId,
			packName: p.name,
			description: p.description,
			icon: p.icon,
			targetAgeMin: p.targetAgeMin,
			targetAgeMax: p.targetAgeMax,
			tags: p.tags,
			activityCount: p.itemCount,
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

		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return fail(404, { error: 'パックが見つかりません' });

		const activities = (pack.payload as ActivityPackPayload).activities as ActivityPackItem[];
		const preview = await previewActivityImport(activities, tenantId);
		if (preview.newActivities === 0) {
			return { success: true, imported: 0, message: 'すべての活動は登録済みです' };
		}

		await importActivities(activities, tenantId);
		redirect(302, '/admin/packs');
	},
};
