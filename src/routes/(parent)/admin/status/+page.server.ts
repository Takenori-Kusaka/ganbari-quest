import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { getMaxForAge } from '$lib/domain/validation/status';
import { getAllChildren } from '$lib/server/services/child-service';
import { findAllBenchmarks, upsertBenchmark } from '$lib/server/db/status-repo';
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

	const benchmarks = findAllBenchmarks();

	return { children: childrenWithStatus, categoryDefs: CATEGORY_DEFS, benchmarks };
};

export const actions = {
	updateStatus: async ({ request }) => {
		const form = await request.formData();
		const childId = Number(form.get('childId'));
		const categoryId = Number(form.get('categoryId'));
		const newValue = Number(form.get('value'));

		if (!childId || !categoryId) {
			return fail(400, { error: '必須項目が不足しています' });
		}

		// 現在のステータスを取得して差分計算
		const currentStatus = getChildStatus(childId);
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

		updateStatus(childId, categoryId, changeAmount, 'admin_edit');

		return { success: true, categoryId, newValue };
	},
	updateBenchmark: async ({ request }) => {
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

		upsertBenchmark(age, categoryId, mean, stdDev, '管理画面');
		return { success: true, benchmarkUpdated: true };
	},
} satisfies Actions;
