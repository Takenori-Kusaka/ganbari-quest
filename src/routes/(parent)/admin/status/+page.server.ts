import { fail } from '@sveltejs/kit';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { findAllBenchmarks, upsertBenchmark } from '$lib/server/db/status-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	getBenchmarkValues,
	getChildStatus,
	getLevelTitleList,
	getMonthlyComparison,
	resetAllLevelTitles,
	resetLevelTitle,
	saveLevelTitle,
} from '$lib/server/services/status-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const [children, benchmarks, levelTitles] = await Promise.all([
		getAllChildren(tenantId),
		findAllBenchmarks(tenantId),
		getLevelTitleList(tenantId),
	]);

	const childrenWithStatus = await Promise.all(
		children.map(async (child) => {
			const [status, monthlyComparison, benchmarkValues] = await Promise.all([
				getChildStatus(child.id, tenantId),
				getMonthlyComparison(child.id, tenantId),
				getBenchmarkValues(child.age, tenantId),
			]);
			return {
				...child,
				status: 'error' in status ? null : status,
				monthlyComparison,
				benchmarkValues,
			};
		}),
	);

	return { children: childrenWithStatus, categoryDefs: CATEGORY_DEFS, benchmarks, levelTitles };
};

export const actions = {
	saveLevelTitle: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const level = Number(form.get('level'));
		const customTitle = String(form.get('customTitle') ?? '').trim();

		if (!level || level < 1 || level > 10) {
			return fail(400, { error: 'レベルが不正です' });
		}
		if (!customTitle || customTitle.length > 20) {
			return fail(400, { error: '称号は1〜20文字で入力してください' });
		}

		await saveLevelTitle(tenantId, level, customTitle);
		return { success: true, levelTitleUpdated: true };
	},

	resetLevelTitle: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const level = Number(form.get('level'));

		if (!level || level < 1 || level > 10) {
			return fail(400, { error: 'レベルが不正です' });
		}

		await resetLevelTitle(tenantId, level);
		return { success: true, levelTitleReset: true };
	},

	resetAllLevelTitles: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		await resetAllLevelTitles(tenantId);
		return { success: true, levelTitlesAllReset: true };
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
