// #1756 (#1709-B): 親 UI — 活動編集を独立 URL に分離。
//   /admin/activities/[id]/edit で must トグル + 既存編集項目を扱う。
//   form action は $lib/server/services/activity-service 経由で priority を含めた更新を行う。

import { error, fail, redirect } from '@sveltejs/kit';
import { formIdString } from '$lib/domain/form-value';
import { asActivityId, asCategoryId } from '$lib/domain/ids';
// #4512: form action のエラー文言は labels SSOT 経由 (docs/DESIGN.md §6 / ADR-0045)
import { ADMIN_ACTIVITIES_PAGE_LABELS, ADMIN_FORM_ERROR_LABELS } from '$lib/domain/labels';
import {
	CATEGORY_DEFS,
	getCategoryById,
	sanitizeActivityNameField,
	sanitizeDailyLimit,
} from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { getActivityById, updateActivity } from '$lib/server/services/activity-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const tenantId = requireTenantId(locals);
	const id = asActivityId(params.id);
	if (!id) {
		error(400, ADMIN_ACTIVITIES_PAGE_LABELS.activityIdInvalid);
	}
	const activity = await getActivityById(id, tenantId);
	if (!activity) {
		error(404, ADMIN_ACTIVITIES_PAGE_LABELS.activityNotFound);
	}
	return {
		activity,
		categoryDefs: CATEGORY_DEFS,
	};
};

export const actions: Actions = {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 多項目編集 form の単純な分解。複雑度より読みやすさを優先
	save: async ({ request, locals, params }) => {
		const tenantId = requireTenantId(locals);
		const id = asActivityId(params.id);
		if (!id) {
			return fail(400, { error: ADMIN_ACTIVITIES_PAGE_LABELS.activityIdInvalid });
		}

		const formData = await request.formData();
		const name = String(formData.get('name') ?? '').trim();
		const categoryId = asCategoryId(formIdString(formData.get('categoryId')));
		const icon = String(formData.get('icon') ?? '📝');
		const basePoints = Number(formData.get('basePoints') ?? 5);
		const ageMin = formData.get('ageMin') ? Number(formData.get('ageMin')) : null;
		const ageMax = formData.get('ageMax') ? Number(formData.get('ageMax')) : null;
		const dailyLimitRaw = formData.get('dailyLimit');
		const dailyLimit = sanitizeDailyLimit(dailyLimitRaw); // #3463 item1/item4: NaN/負/巨大/非整数を [0,99] int or null に clamp (負値→null=1回 安全既定)
		const nameKana = sanitizeActivityNameField(
			String(formData.get('nameKana') ?? '').trim() || null,
		);
		const nameKanji = sanitizeActivityNameField(
			String(formData.get('nameKanji') ?? '').trim() || null,
		);
		const triggerHint = String(formData.get('triggerHint') ?? '').trim() || null;
		// #1756 (#1709-B): must トグル — checkbox は ON 時 'on' / OFF 時 null
		const priorityRaw = formData.get('priority');
		const priority: 'must' | 'optional' = priorityRaw === 'must' ? 'must' : 'optional';

		if (!name) return fail(400, { error: ADMIN_FORM_ERROR_LABELS.nameRequired });
		if (!categoryId || !getCategoryById(categoryId)) {
			return fail(400, { error: ADMIN_FORM_ERROR_LABELS.categoryRequired });
		}

		try {
			await updateActivity(
				id,
				{
					name,
					categoryId,
					icon,
					basePoints,
					ageMin,
					ageMax,
					dailyLimit,
					nameKana,
					nameKanji,
					triggerHint,
					priority,
				},
				tenantId,
			);
		} catch (e) {
			logger.error('[admin/activities/[id]/edit] 活動更新失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { id, name, priority },
			});
			return fail(500, { error: ADMIN_FORM_ERROR_LABELS.updateFailed });
		}

		// 更新成功 → 一覧画面にリダイレクト
		redirect(303, '/admin/activities');
	},
};
