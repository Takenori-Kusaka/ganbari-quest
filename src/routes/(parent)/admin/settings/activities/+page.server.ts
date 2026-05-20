// #2322 (EPIC #2319 ③): activities グループ load + action。
// 旧 /admin/settings/+page.server.ts から decay / point / defaultChild / sibling 関連を移行。

import { fail } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { CURRENCY_CODES } from '$lib/domain/point-display';
import { requireTenantId } from '$lib/server/auth/factory';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import { getDefaultChildId, setDefaultChildId } from '$lib/server/services/default-child-service';
import { getPlanLimits, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	let decayIntensity = 'normal';
	let siblingMode = 'both';
	let siblingRankingEnabled = 'false';
	let children: Awaited<ReturnType<typeof getAllChildren>> = [];
	let defaultChildId: number | null = null;

	const planTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	const planLimits = getPlanLimits(planTier);

	try {
		[decayIntensity, siblingMode, siblingRankingEnabled, children, defaultChildId] =
			await Promise.all([
				getSetting('decay_intensity', tenantId).then((v) => v ?? 'normal'),
				getSetting('sibling_mode', tenantId).then((v) => v ?? 'both'),
				getSetting('sibling_ranking_enabled', tenantId).then((v) => v ?? 'false'),
				getAllChildren(tenantId),
				getDefaultChildId(tenantId),
			]);
	} catch (err) {
		logger.error('[settings/activities] load failed, using defaults', {
			error: String(err),
		});
	}

	return {
		decayIntensity,
		siblingMode,
		siblingRankingEnabled,
		canSiblingRanking: planLimits.canSiblingRanking,
		children: children.map((c) => ({ id: c.id, nickname: c.nickname })),
		defaultChildId,
	};
};

export const actions = {
	updateDefaultChild: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const raw = form.get('defaultChildId')?.toString() ?? '';

		if (raw === '' || raw === 'none') {
			await setDefaultChildId(tenantId, null);
			return { defaultChildUpdated: true };
		}

		const childId = Number(raw);
		if (!Number.isFinite(childId) || childId <= 0) {
			return fail(400, { defaultChildError: '子供IDが不正です' });
		}

		const children = await getAllChildren(tenantId);
		if (!children.some((c) => c.id === childId)) {
			return fail(400, { defaultChildError: '指定された子供が見つかりません' });
		}

		await setDefaultChildId(tenantId, childId);
		return { defaultChildUpdated: true };
	},

	updatePointSettings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const mode = form.get('point_unit_mode')?.toString() ?? 'point';
		const currency = form.get('point_currency')?.toString() ?? 'JPY';
		const rateStr = form.get('point_rate')?.toString() ?? '1';

		if (mode !== 'point' && mode !== 'currency') {
			return fail(400, { pointError: 'モードが不正です' });
		}
		if (!CURRENCY_CODES.includes(currency as CurrencyCode)) {
			return fail(400, { pointError: '通貨コードが不正です' });
		}
		const rate = Number.parseFloat(rateStr);
		if (Number.isNaN(rate) || rate <= 0 || rate > 10000) {
			return fail(400, { pointError: 'レートは0より大きく10000以下で入力してください' });
		}

		await setSetting('point_unit_mode', mode as PointUnitMode, tenantId);
		await setSetting('point_currency', currency, tenantId);
		await setSetting('point_rate', String(rate), tenantId);

		return { pointSuccess: true };
	},

	updateSiblingSettings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const mode = form.get('siblingMode')?.toString() ?? 'both';
		const rankingRequested = form.has('siblingRankingEnabled');

		if (!['cooperative', 'competitive', 'both'].includes(mode)) {
			return fail(400, { siblingError: '不正なモードです' });
		}

		const planTier = await resolveFullPlanTier(
			tenantId,
			locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
			locals.context?.plan,
		);
		const planLimits = getPlanLimits(planTier);

		if (rankingRequested && !planLimits.canSiblingRanking) {
			return fail(403, {
				siblingError: createPlanLimitError(
					planTier,
					'family',
					PLAN_GATE_LABELS.familyLimitedWithUpgradeFor('きょうだいランキング'),
				),
				upgradeRequired: true,
			});
		}

		const rankingEnabled = rankingRequested && planLimits.canSiblingRanking ? 'true' : 'false';

		await setSetting('sibling_mode', mode, tenantId);
		await setSetting('sibling_ranking_enabled', rankingEnabled, tenantId);

		return { siblingSuccess: true };
	},
} satisfies Actions;
