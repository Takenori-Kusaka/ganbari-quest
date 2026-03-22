import { logger } from '$lib/server/logger';
import { getChildAchievements } from '$lib/server/services/achievement-service';
import { getActivityLogs } from '$lib/server/services/activity-log-service';
import { getBirthdayReviews } from '$lib/server/services/birthday-service';
import {
	addChild,
	editChild,
	getAllChildren,
	removeChild,
} from '$lib/server/services/child-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getChildStatus } from '$lib/server/services/status-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const children = await getAllChildren();
	const selectedId = url.searchParams.get('id');

	const childrenSummary = await Promise.all(
		children.map(async (child) => {
			const balance = await getPointBalance(child.id);
			const status = await getChildStatus(child.id);
			if ('error' in balance) {
				logger.warn('[admin/children] ポイント取得フォールバック', {
					context: { childId: child.id, error: balance.error },
				});
			}
			if ('error' in status) {
				logger.warn('[admin/children] ステータス取得フォールバック', {
					context: { childId: child.id, error: status.error },
				});
			}
			return {
				...child,
				balance: 'error' in balance ? 0 : balance.balance,
				level: 'error' in status ? 1 : status.level,
				levelTitle: 'error' in status ? '' : status.levelTitle,
			};
		}),
	);

	let selectedChild = null;
	if (selectedId) {
		const id = Number(selectedId);
		const child = children.find((c) => c.id === id);
		if (child) {
			const balance = await getPointBalance(id);
			const status = await getChildStatus(id);
			const logs = await getActivityLogs(id, {});
			const achievements = await getChildAchievements(id);

			if ('error' in balance) {
				logger.warn('[admin/children] 詳細ポイント取得フォールバック', {
					context: { childId: id, error: balance.error },
				});
			}
			if ('error' in status) {
				logger.warn('[admin/children] 詳細ステータス取得フォールバック', {
					context: { childId: id, error: status.error },
				});
			}

			const birthdayReviews = await getBirthdayReviews(id);

			selectedChild = {
				...child,
				balance: 'error' in balance ? null : balance,
				status: 'error' in status ? null : status,
				recentLogs: 'error' in logs ? [] : logs.logs.slice(0, 20),
				logSummary: 'error' in logs ? null : logs.summary,
				achievements: achievements,
				birthdayReviews,
			};
		}
	}

	return { children: childrenSummary, selectedChild };
};

export const actions: Actions = {
	addChild: async ({ request }) => {
		const formData = await request.formData();
		const nickname = formData.get('nickname')?.toString().trim();
		const age = Number(formData.get('age'));
		const theme = formData.get('theme')?.toString() || 'pink';

		if (!nickname || nickname.length === 0) {
			return fail(400, { error: 'ニックネームを入力してください' });
		}
		if (Number.isNaN(age) || age < 0 || age > 18) {
			return fail(400, { error: '年齢は0〜18で入力してください' });
		}

		const child = await addChild({ nickname, age, theme });
		return { success: true, addedChild: child };
	},

	editChild: async ({ request }) => {
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const nickname = formData.get('nickname')?.toString().trim();
		const age = Number(formData.get('age'));
		const theme = formData.get('theme')?.toString();

		if (Number.isNaN(childId)) {
			return fail(400, { error: 'IDが不正です' });
		}

		const updates: Record<string, string | number> = {};
		if (nickname && nickname.length > 0) updates.nickname = nickname;
		if (!Number.isNaN(age) && age >= 0 && age <= 18) updates.age = age;
		if (theme) updates.theme = theme;

		await editChild(childId, updates);
		return { success: true, editedChildId: childId };
	},

	removeChild: async ({ request }) => {
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));

		if (Number.isNaN(childId)) {
			return fail(400, { error: 'IDが不正です' });
		}

		await removeChild(childId);
		return { success: true, removedChildId: childId };
	},
};
