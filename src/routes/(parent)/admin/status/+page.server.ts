import { CATEGORIES } from '$lib/domain/validation/activity';
import { getAllChildren } from '$lib/server/services/child-service';
import { getChildStatus, updateStatus } from '$lib/server/services/status-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const children = getAllChildren();

	const childrenWithStatus = children.map((child) => {
		const status = getChildStatus(child.id);
		return {
			...child,
			status: 'error' in status ? null : status,
		};
	});

	return { children: childrenWithStatus, categories: CATEGORIES };
};

export const actions = {
	updateStatus: async ({ request }) => {
		const form = await request.formData();
		const childId = Number(form.get('childId'));
		const category = form.get('category')?.toString() ?? '';
		const newValue = Number(form.get('value'));

		if (!childId || !category) {
			return fail(400, { error: '必須項目が不足しています' });
		}

		if (Number.isNaN(newValue) || newValue < 0 || newValue > 100) {
			return fail(400, { error: '値は0〜100の範囲で入力してください' });
		}

		// 現在のステータスを取得して差分計算
		const currentStatus = getChildStatus(childId);
		if ('error' in currentStatus) {
			return fail(404, { error: '子供が見つかりません' });
		}

		const currentValue = currentStatus.statuses[category]?.value ?? 0;
		const changeAmount = newValue - currentValue;

		if (changeAmount === 0) {
			return { success: true, noChange: true };
		}

		updateStatus(childId, category, changeAmount, 'admin_edit');

		return { success: true, category, newValue };
	},
} satisfies Actions;
