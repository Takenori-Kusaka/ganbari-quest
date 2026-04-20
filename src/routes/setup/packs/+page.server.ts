import { redirect } from '@sveltejs/kit';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import type { ActivityPackItem } from '$lib/domain/activity-pack';
import type { ActivityPackPayload } from '$lib/domain/marketplace-item';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	importActivities,
	previewActivityImport,
} from '$lib/server/services/activity-import-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);

	// Guard: No children -> go back to step 1
	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	// Compute child age range for recommendations
	const ages = children.map((c) => c.age);
	const minAge = Math.min(...ages);
	const maxAge = Math.max(...ages);

	const activityPackMetas = getMarketplaceIndex().filter((m) => m.type === 'activity-pack');

	// Pack preview: include activity names for each pack
	const packsWithPreview = activityPackMetas.map((p) => {
		const full = getMarketplaceItem('activity-pack', p.itemId);
		const payload = full?.payload as ActivityPackPayload | undefined;
		return {
			packId: p.itemId,
			packName: p.name,
			description: p.description,
			icon: p.icon,
			targetAgeMin: p.targetAgeMin,
			targetAgeMax: p.targetAgeMax,
			tags: p.tags,
			activityCount: p.itemCount,
			activities: payload
				? payload.activities.map((a) => ({
						name: a.name,
						icon: a.icon,
						categoryCode: a.categoryCode,
					}))
				: [],
		};
	});

	return {
		packs: packsWithPreview,
		childAgeMin: minAge,
		childAgeMax: maxAge,
	};
};

export const actions: Actions = {
	importPacks: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const packIds = formData.getAll('packIds').map((v) => v.toString());

		if (packIds.length === 0) {
			// Skip selected — no packs to import
			redirect(302, '/setup/complete');
		}

		let totalImported = 0;
		let totalSkipped = 0;
		const allErrors: string[] = [];

		for (const packId of packIds) {
			try {
				const pack = getMarketplaceItem('activity-pack', packId);
				if (!pack) {
					allErrors.push(`パック「${packId}」が見つかりません`);
					continue;
				}
				const activities = (pack.payload as ActivityPackPayload).activities as ActivityPackItem[];
				const preview = await previewActivityImport(activities, tenantId);

				if (preview.newActivities > 0) {
					const result = await importActivities(activities, tenantId);
					totalImported += result.imported;
					totalSkipped += result.skipped;
					allErrors.push(...result.errors);
				} else {
					totalSkipped += preview.total;
				}
			} catch {
				allErrors.push(`パック「${packId}」の読み込みに失敗しました`);
			}
		}

		trackSetupFunnel('setup_packs_selected', tenantId, {
			packCount: packIds.length,
			imported: totalImported,
		});
		redirect(302, `/setup/first-adventure?imported=${totalImported}&skipped=${totalSkipped}`);
	},

	skip: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		// スキップ時も推奨パックを自動適用（初期離脱防止）
		const children = await getAllChildren(tenantId);
		const ages = children.map((c) => c.age);
		const minAge = Math.min(...ages);
		const maxAge = Math.max(...ages);

		let autoImported = 0;
		const activityPackMetas = getMarketplaceIndex().filter((m) => m.type === 'activity-pack');
		for (const p of activityPackMetas) {
			if (p.targetAgeMin <= maxAge && p.targetAgeMax >= minAge) {
				try {
					const pack = getMarketplaceItem('activity-pack', p.itemId);
					if (!pack) continue;
					const activities = (pack.payload as ActivityPackPayload).activities as ActivityPackItem[];
					const preview = await previewActivityImport(activities, tenantId);
					if (preview.newActivities > 0) {
						const result = await importActivities(activities, tenantId);
						autoImported += result.imported;
					}
				} catch {
					// 自動適用失敗は無視（ユーザーは後から手動インポート可能）
				}
			}
		}

		trackSetupFunnel('setup_packs_skipped', tenantId, {
			autoImported,
		});
		redirect(302, `/setup/first-adventure?imported=${autoImported}&skipped=0`);
	},
};
