import { fail } from '@sveltejs/kit';
import {
	demoCancelRecord,
	demoClaimLoginBonus,
	demoRecordActivity,
	demoTogglePin,
	getDemoHomeData,
} from '$lib/server/demo/demo-service.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) {
		return getDemoHomeData(0);
	}
	return getDemoHomeData(child.id);
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
