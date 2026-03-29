import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { findAllBenchmarks, upsertBenchmark } from '$lib/server/db/status-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import { getChildStatus } from '$lib/server/services/status-service';
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
