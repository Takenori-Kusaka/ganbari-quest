import { fail, redirect } from '@sveltejs/kit';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import type { ActivityPackPayload } from '$lib/domain/marketplace-item';
// #2365 (ADR-0052): 新 Strategy + dispatchImport 経由
import { dispatchImport, marketplaceRegistry } from '$lib/marketplace';
import { loadFromMarketplace } from '$lib/marketplace/sources/marketplace-source';
import { requireTenantId } from '$lib/server/auth/factory';
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
					// #1758 (#1709-D): must 推奨候補フラグを UI へ
					mustDefault: a.mustDefault === true,
				}))
			: [];
		const importedCount = activities.filter((a) => a.alreadyImported).length;
		const mustDefaultCount = activities.filter((a) => a.mustDefault).length;
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
			mustDefaultCount,
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
		// #1758 (#1709-D): must 推奨採用チェックボックス。既定 ON、明示 OFF（hidden=off の規約）で false。
		// HTML checkbox は ON のとき 'on' / 'true' を送り、OFF のとき何も送らない。
		const applyMustDefaultRaw = formData.get('applyMustDefault')?.toString();
		const applyMustDefault =
			applyMustDefaultRaw === 'on' || applyMustDefaultRaw === 'true' || applyMustDefaultRaw === '1';

		if (!packId) return fail(400, { error: 'パックIDが必要です' });

		// 新 Strategy 経由: preview (件数判定) → apply (DB write)
		let source: ReturnType<typeof loadFromMarketplace>;
		try {
			source = loadFromMarketplace('activity-pack', packId);
		} catch {
			return fail(404, { error: 'パックが見つかりません' });
		}

		const descriptor = marketplaceRegistry.get('activity-pack');
		const payload = descriptor.strategy.parse(source.payload) as ActivityPackPayload;
		const preview = await descriptor.strategy.preview(payload, { tenantId });
		if (preview.newItems === 0) {
			return { success: true, imported: 0, message: 'すべての活動は登録済みです' };
		}

		await dispatchImport({
			typeCode: 'activity-pack',
			rawPayload: source.payload,
			displayName: source.displayName,
			ctx: { tenantId, presetId: packId, applyMustDefault },
		});
		redirect(302, '/admin/packs');
	},
};
