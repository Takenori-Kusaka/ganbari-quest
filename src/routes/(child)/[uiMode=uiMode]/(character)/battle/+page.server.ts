import { error } from '@sveltejs/kit';
import { loadBattlePage } from '$lib/features/battle/battle-page-load';
import { requireTenantId } from '$lib/server/auth/factory';
import { executeDailyBattle } from '$lib/server/services/battle-service';
import { getChildStatus } from '$lib/server/services/status-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals, params }) => {
	if (params.uiMode === 'baby' || params.uiMode === 'preschool') {
		error(404, 'このモードではバトルは利用できません');
	}
	return loadBattlePage(parent, locals);
};

export const actions: Actions = {
	executeBattle: async ({ cookies, params, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (!childId) return { success: false, error: 'バトルじょうほうが ありません' };

		const statusResult = await getChildStatus(childId, tenantId);
		if ('error' in statusResult) {
			return { success: false, error: 'ステータスが見つかりません' };
		}

		const categoryXp: Record<number, number> = {};
		for (const [catId, detail] of Object.entries(statusResult.statuses)) {
			categoryXp[Number(catId)] = detail.value;
		}

		const uiMode = params.uiMode ?? 'preschool';

		try {
			const result = await executeDailyBattle(childId, uiMode, categoryXp, tenantId);
			return { success: true, battleResult: result.battleResult };
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : 'バトル実行に失敗しました' };
		}
	},
};
