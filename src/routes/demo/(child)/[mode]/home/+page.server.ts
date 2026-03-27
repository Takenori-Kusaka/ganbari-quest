import { getDemoHomeData } from '$lib/server/demo/demo-service.js';
import {
	demoCancelRecord,
	demoClaimLoginBonus,
	demoRecordActivity,
	demoTogglePin,
} from '$lib/server/demo/demo-service.js';
import { fail } from '@sveltejs/kit';
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

	submitBirthday: async () => {
		return {
			success: true,
			birthdayReview: true,
			basePoints: 50,
			healthPoints: 250,
			aspirationPoints: 200,
			totalPoints: 500,
		};
	},
};
