import { fail } from '@sveltejs/kit';
import {
	demoCancelRecord,
	demoClaimLoginBonus,
	demoRecordActivity,
	demoTogglePin,
	getDemoHomeData,
} from '$lib/server/demo/demo-service.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * ADR-0047 Phase 3 (#2097): demo +page.server.ts は本番互換 shape を返す。
 *
 * - `getDemoHomeData()` が本番 `+page.server.ts` と等価な shape を提供 (Phase 3 で拡張済)。
 * - 追加で `uiMode` / `planTier` / `isPremium` を含めて `DashboardView` の ViewModel 経路
 *   (toViewModel(ctx)) に必要な context を満たす。
 */
export const load: PageServerLoad = async ({ parent }) => {
	const parentData = await parent();
	const { child } = parentData;
	const homeData = child ? getDemoHomeData(child.id) : getDemoHomeData(0);

	return {
		...homeData,
		uiMode: parentData.uiMode ?? 'preschool',
		// demo は固定 standard プラン (PO Q4 = A demo 固定 P、Q5 = B 子供は買える)
		planTier: 'standard' as const,
		isPremium: true,
	};
};

export const actions: Actions = {
	record: async ({ request }) => {
		const formData = await request.formData();
		const activityId = Number(formData.get('activityId'));
		if (Number.isNaN(activityId)) return fail(400, { error: 'パラメータが不正です' });
		return demoRecordActivity(activityId);
	},

	cancelRecord: async () => {
		return demoCancelRecord();
	},

	claimBonus: async () => {
		return demoClaimLoginBonus();
	},

	togglePin: async ({ request }) => {
		const formData = await request.formData();
		const pinned = formData.get('pinned') === 'true';
		return demoTogglePin(pinned);
	},
};
