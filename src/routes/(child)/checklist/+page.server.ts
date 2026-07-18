import { fail } from '@sveltejs/kit';
import { todayDateJST } from '$lib/domain/date-utils';
import { formIdString } from '$lib/domain/form-value';
import { asChildId } from '$lib/domain/ids';
import { requireValidChildCookieFormat } from '$lib/server/auth/child-cookie-guard';
import { isValidUuidFormField } from '$lib/server/auth/child-form-field-guard';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	getChecklistsForChild,
	getCurrentTimeSlot,
	toggleCheckItem,
} from '$lib/server/services/checklist-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { checklists: [] };

	const today = todayDateJST();
	const checklists = await getChecklistsForChild(child.id, today, tenantId);

	return { checklists, currentTimeSlot: getCurrentTimeSlot() };
};

export const actions: Actions = {
	toggle: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend で stale/非 uuid cookie を cookie clear + /switch redirect に正規化
		// (findAssignmentsByChild へ生 id が直達し 22P02 → 500 になる CWE-20 を trust 境界で断つ)。
		const childIdStr = requireValidChildCookieFormat(cookies, 'route.checklist.toggle');
		const formData = await request.formData();
		const childId = asChildId(childIdStr);
		const templateId = formIdString(formData.get('templateId'));
		const itemId = formIdString(formData.get('itemId'));
		const checked = formData.get('checked') === '1';

		if (Number.isNaN(childId) || Number.isNaN(templateId) || Number.isNaN(itemId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}
		// #3799: form-field 由来 templateId が checklist-service → findTemplateById の
		// `template_id = ${templateId}` (dsql uuid 列) へ直達し 22P02 になる CWE-20 を trust 境界で断つ。
		// itemId は checklist.items の JS メンバシップ照合のみ (uuid 列非到達) のため guard 対象外。
		if (!isValidUuidFormField(templateId, 'route.checklist.toggle.templateId')) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const today = todayDateJST();
		const result = await toggleCheckItem(childId, templateId, itemId, today, checked, tenantId);

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
