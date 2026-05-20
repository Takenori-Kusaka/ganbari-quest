// #2323 (EPIC #2319 ④): data グループ load + action。
// 旧 /admin/settings/+page.server.ts から data / cloud / clear 関連を移行。

import { fail } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { clearAllFamilyData, getDataSummary } from '$lib/server/services/data-service';
import { getPlanLimits, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	let dataSummary: Awaited<ReturnType<typeof getDataSummary>> = {
		children: 0,
		activityLogs: 0,
		pointLedger: 0,
		statuses: 0,
		achievements: 0,
		loginBonuses: 0,
		checklistTemplates: 0,
		voices: 0,
	};

	const planTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	const planLimits = getPlanLimits(planTier);

	try {
		dataSummary = await getDataSummary(tenantId);
	} catch (err) {
		logger.error('[settings/data] load failed', { error: String(err) });
	}

	return {
		dataSummary,
		canExport: planLimits.canExport,
		maxCloudExports: planLimits.maxCloudExports,
	};
};

export const actions = {
	clearData: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const confirm = form.get('confirm')?.toString() ?? '';
		const agree = form.get('agree')?.toString() ?? '';

		if (confirm !== '削除') {
			return fail(400, { clearError: '確認テキスト「削除」を入力してください' });
		}
		if (agree !== 'true') {
			return fail(400, { clearError: '同意チェックを入れてください' });
		}

		try {
			const result = await clearAllFamilyData(tenantId);
			logger.info(`[data-clear] 家庭 ${tenantId} のデータクリア完了`);
			return { clearSuccess: true, cleared: result.deleted };
		} catch (err) {
			logger.error('[data-clear] データクリア失敗', { error: String(err) });
			return fail(500, { clearError: 'データクリアに失敗しました' });
		}
	},
} satisfies Actions;
