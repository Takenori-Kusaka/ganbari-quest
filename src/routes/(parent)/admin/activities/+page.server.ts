import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { logger } from '$lib/server/logger';
import {
	createActivity,
	deleteActivityWithCleanup,
	getActivities,
	getActivityLogCounts,
	hasActivityLogs,
	setActivityVisibility,
	updateActivity,
} from '$lib/server/services/activity-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const activities = await getActivities({ includeHidden: true });
	const logCounts = await getActivityLogCounts();
	return { activities, categoryDefs: CATEGORY_DEFS, logCounts };
};

export const actions: Actions = {
	toggleVisibility: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const visible = formData.get('visible') === 'true';

		if (!id) return fail(400, { error: 'IDが必要です' });

		try {
			await setActivityVisibility(id, visible);
			return { success: true };
		} catch (e) {
			logger.error('[admin/activities] 表示切替失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { id, visible },
			});
			return fail(500, { error: '更新に失敗しました' });
		}
	},

	create: async ({ request }) => {
		const formData = await request.formData();
		const name = String(formData.get('name') ?? '').trim();
		const categoryId = Number(formData.get('categoryId') ?? 0);
		const icon = String(formData.get('icon') ?? '📝');
		const basePoints = Number(formData.get('basePoints') ?? 5);
		const ageMin = formData.get('ageMin') ? Number(formData.get('ageMin')) : null;
		const ageMax = formData.get('ageMax') ? Number(formData.get('ageMax')) : null;
		const dailyLimitRaw = formData.get('dailyLimit');
		const dailyLimit = dailyLimitRaw != null && dailyLimitRaw !== '' ? Number(dailyLimitRaw) : null;
		const nameKana = String(formData.get('nameKana') ?? '').trim() || null;
		const nameKanji = String(formData.get('nameKanji') ?? '').trim() || null;

		if (!name) return fail(400, { error: '名前を入力してください' });
		if (!categoryId || categoryId < 1 || categoryId > 5) {
			return fail(400, { error: 'カテゴリを選択してください' });
		}

		try {
			await createActivity({
				name,
				categoryId,
				icon,
				basePoints,
				ageMin,
				ageMax,
				dailyLimit,
				source: 'parent',
				nameKana,
				nameKanji,
			});
			return { created: true };
		} catch (e) {
			logger.error('[admin/activities] 活動追加失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { name, categoryId },
			});
			return fail(500, { error: '追加に失敗しました' });
		}
	},

	edit: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const name = String(formData.get('name') ?? '').trim();
		const categoryId = Number(formData.get('categoryId') ?? 0);
		const icon = String(formData.get('icon') ?? '📝');
		const basePoints = Number(formData.get('basePoints') ?? 5);
		const ageMin = formData.get('ageMin') ? Number(formData.get('ageMin')) : null;
		const ageMax = formData.get('ageMax') ? Number(formData.get('ageMax')) : null;
		const dailyLimitRaw = formData.get('dailyLimit');
		const dailyLimit = dailyLimitRaw != null && dailyLimitRaw !== '' ? Number(dailyLimitRaw) : null;
		const nameKana = String(formData.get('nameKana') ?? '').trim() || null;
		const nameKanji = String(formData.get('nameKanji') ?? '').trim() || null;

		if (!id) return fail(400, { error: 'IDが必要です' });
		if (!name) return fail(400, { error: '名前を入力してください' });
		if (!categoryId || categoryId < 1 || categoryId > 5) {
			return fail(400, { error: 'カテゴリを選択してください' });
		}

		try {
			await updateActivity(id, {
				name,
				categoryId,
				icon,
				basePoints,
				ageMin,
				ageMax,
				dailyLimit,
				nameKana,
				nameKanji,
			});
			return { edited: true };
		} catch (e) {
			logger.error('[admin/activities] 活動編集失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { id, name },
			});
			return fail(500, { error: '更新に失敗しました' });
		}
	},

	delete: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id) return fail(400, { error: 'IDが必要です' });

		try {
			if (await hasActivityLogs(id)) {
				await setActivityVisibility(id, false);
				return { hidden: true };
			}

			await deleteActivityWithCleanup(id);
			return { deleted: true };
		} catch (e) {
			logger.error('[admin/activities] 活動削除失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { id },
			});
			return fail(500, { error: '削除に失敗しました' });
		}
	},
};
