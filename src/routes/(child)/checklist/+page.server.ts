import { todayDateJST } from '$lib/domain/date-utils';
import { getChecklistsForChild, toggleCheckItem } from '$lib/server/services/checklist-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { checklists: [] };

	const today = todayDateJST();
	const checklists = getChecklistsForChild(child.id, today);

	return { checklists };
};

export const actions: Actions = {
	toggle: async ({ request, cookies }) => {
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const templateId = Number(formData.get('templateId'));
		const itemId = Number(formData.get('itemId'));
		const checked = formData.get('checked') === '1';

		if (Number.isNaN(childId) || Number.isNaN(templateId) || Number.isNaN(itemId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const today = todayDateJST();
		const result = toggleCheckItem(childId, templateId, itemId, today, checked);

		if ('error' in result) {
			return fail(404, { error: 'みつかりません' });
		}

		return {
			success: true,
			checkedCount: result.checkedCount,
			totalCount: result.totalCount,
			completedAll: result.completedAll,
			pointsAwarded: result.pointsAwarded,
			newlyCompleted: result.newlyCompleted,
		};
	},
};
