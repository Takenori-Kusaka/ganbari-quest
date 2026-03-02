import { CATEGORIES } from '$lib/domain/validation/activity';
import {
	createActivity,
	getActivities,
	setActivityVisibility,
} from '$lib/server/services/activity-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const activities = getActivities({ includeHidden: true });
	return { activities, categories: CATEGORIES };
};

export const actions: Actions = {
	toggleVisibility: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const visible = formData.get('visible') === 'true';

		if (!id) return fail(400, { error: 'IDが必要です' });

		try {
			setActivityVisibility(id, visible);
			return { success: true };
		} catch {
			return fail(500, { error: '更新に失敗しました' });
		}
	},

	create: async ({ request }) => {
		const formData = await request.formData();
		const name = String(formData.get('name') ?? '').trim();
		const category = String(formData.get('category') ?? '');
		const icon = String(formData.get('icon') ?? '📝');
		const basePoints = Number(formData.get('basePoints') ?? 5);
		const ageMin = formData.get('ageMin') ? Number(formData.get('ageMin')) : null;
		const ageMax = formData.get('ageMax') ? Number(formData.get('ageMax')) : null;

		if (!name) return fail(400, { error: '名前を入力してください' });
		if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
			return fail(400, { error: 'カテゴリを選択してください' });
		}

		try {
			createActivity({
				name,
				category: category as (typeof CATEGORIES)[number],
				icon,
				basePoints,
				ageMin,
				ageMax,
				source: 'parent',
			});
			return { created: true };
		} catch {
			return fail(500, { error: '追加に失敗しました' });
		}
	},
};
