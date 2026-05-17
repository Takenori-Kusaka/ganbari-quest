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

export const load: PageServerLoad = async ({ locals, url }) => {
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

	// #2200: `?childId=N` クエリで指定された child を先頭に配置する。
	//   実画面で「`/admin/status?childId=903` を bookmark」した時の挙動と一致 (URL 不変式)。
	//   LP 撮影では `feature-monthly-report` SS で elementary fixture けんたくん (903・3,400P) を
	//   先頭に映してレーダー 5 軸を埋める用途 (ADR-0013 LP truth 整合)。
	//   不正な childId / 該当 child なしの場合は何もしない (デフォルト children[0])。
	const requestedChildIdRaw = url.searchParams.get('childId');
	const requestedChildId = requestedChildIdRaw ? Number.parseInt(requestedChildIdRaw, 10) : NaN;
	const sortedChildren = Number.isFinite(requestedChildId)
		? [
				...childrenWithStatus.filter((c) => c.id === requestedChildId),
				...childrenWithStatus.filter((c) => c.id !== requestedChildId),
			]
		: childrenWithStatus;

	return { children: sortedChildren, categoryDefs: CATEGORY_DEFS, benchmarks, levelTitles };
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

		// #2057: 内部 source identifier (DB 保存値、UI 表示なし)。既存レコードとの履歴整合のため
		// 「管理画面」リテラルを保持。UI 表記は ADMIN_VIEW_TERMS.canonical で別途集約済。
		await upsertBenchmark(age, categoryId, mean, stdDev, '管理画面', tenantId);
		return { success: true, benchmarkUpdated: true };
	},
} satisfies Actions;
