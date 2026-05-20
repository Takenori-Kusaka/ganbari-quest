// #2322 (EPIC #2319 ③): setup wizard 任意 step「活動・ポイント設定の初期値」
// マーケプレ rule-preset 集約 (PO 提案) を Research が否定したため、代替案 A として
// **setup フローに sensible defaults を hard-code する** パターンを採用。
//
// Challenges EPIC #2298 (`setup/challenges/+page.server.ts`) を template として横展開（ADR-0014 整合）。
// - 親が「おすすめを適用してすすむ」を押すと 6 setting key を一括 set
// - skip 可（ADR-0012 anti-engagement 整合）
// - 次の遷移先は /setup/challenges

import { redirect } from '@sveltejs/kit';
import {
	ACTIVITIES_SETTINGS_DEFAULTS,
	activitiesDefaultsToSettingPairs,
} from '$lib/data/setup-defaults-activities';
import { requireTenantId } from '$lib/server/auth/factory';
import { setSetting } from '$lib/server/db/settings-repo';
import { getAllChildren } from '$lib/server/services/child-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);

	// Guard: 子供が 0 名なら step 1 へ戻す（rewards / rules / challenges と同パターン）
	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	return {
		defaults: ACTIVITIES_SETTINGS_DEFAULTS,
	};
};

export const actions: Actions = {
	apply: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		const pairs = activitiesDefaultsToSettingPairs();
		for (const [key, value] of pairs) {
			await setSetting(key, value, tenantId);
		}
		trackSetupFunnel('setup_activities_defaults_applied', tenantId, {
			settingCount: pairs.length,
		});
		redirect(302, '/setup/challenges?activitiesDefaultsApplied=1');
	},

	skip: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		trackSetupFunnel('setup_activities_defaults_skipped', tenantId, {});
		redirect(302, '/setup/challenges?activitiesDefaultsApplied=0');
	},
};
