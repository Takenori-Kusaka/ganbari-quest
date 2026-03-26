import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { findAllBenchmarks, upsertBenchmark } from '$lib/server/db/status-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import { getChildStatus, updateStatus } from '$lib/server/services/status-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);

	const childrenWithStatus = await Promise.all(
		children.map(async (child) => {
			const status = await getChildStatus(child.id, tenantId);
			return {
				...child,
				status: 'error' in status ? null : status,
			};
		}),
	);

	const benchmarks = await findAllBenchmarks(tenantId);

	return { children: childrenWithStatus, categoryDefs: CATEGORY_DEFS, benchmarks };
};

export const actions = {
	updateStatus: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const childId = Number(form.get('childId'));
		const categoryId = Number(form.get('categoryId'));
		const newValue = Number(form.get('value'));

		if (!childId || !categoryId) {
			return fail(400, { error: '必須項目が不足しています' });
		}

		// 現在のステータスを取得して差分計算
		const currentStatus = await getChildStatus(childId, tenantId);
		if ('error' in currentStatus) {
			return fail(404, { error: '子供が見つかりません' });
		}

		const maxForAge = currentStatus.maxValue;
		if (Number.isNaN(newValue) || newValue < 0 || newValue > maxForAge) {
			return fail(400, { error: `値は0〜${maxForAge}の範囲で入力してください` });
		}

		const currentValue = currentStatus.statuses[categoryId]?.value ?? 0;
		const changeAmount = newValue - currentValue;

		if (changeAmount === 0) {
			return { success: true, noChange: true };
		}

		await updateStatus(childId, categoryId, changeAmount, 'admin_edit', tenantId);

		return { success: true, categoryId, newValue };
	},
	updateBenchmark: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const age = Number(form.get('age'));
		const categoryId = Number(form.get('categoryId'));
		const mean = Number(form.get('mean'));
		const stdDev = Number(form.get('stdDev'));

		if (!age || !categoryId || Number.isNaN(mean) || Number.isNaN(stdDev)) {
			return fail(400, { error: '必須項目が不足しています' });
		}
		if (mean < 0 || stdDev <= 0) {
			return fail(400, { error: '平均は0以上、標準偏差は0より大きい値を入力してください' });
		}

		await upsertBenchmark(age, categoryId, mean, stdDev, '管理画面', tenantId);
		return { success: true, benchmarkUpdated: true };
	},
} satisfies Actions;
