import type { PointSettings } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { getAuthMode, requireTenantId } from '$lib/server/auth/factory';
import { getSettings } from '$lib/server/db/settings-repo';
import { isPaidTier, resolvePlanTier } from '$lib/server/services/plan-limit-service';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const authMode = getAuthMode();

	const pointSettingsRaw = await getSettings(
		[
			'point_unit_mode',
			'point_currency',
			'point_rate',
			'tutorial_started_at',
			'tutorial_banner_dismissed',
		],
		tenantId,
	);
	const pointSettings: PointSettings = {
		mode: (pointSettingsRaw.point_unit_mode as PointUnitMode) ?? DEFAULT_POINT_SETTINGS.mode,
		currency: (pointSettingsRaw.point_currency as CurrencyCode) ?? DEFAULT_POINT_SETTINGS.currency,
		rate: Number.parseFloat(pointSettingsRaw.point_rate ?? '') || DEFAULT_POINT_SETTINGS.rate,
	};

	const tenantStatus = locals.context?.tenantStatus ?? 'active';
	const planTier = resolvePlanTier(locals.context?.licenseStatus ?? 'none');
	const isPremium = isPaidTier(planTier);
	const tutorialStarted = !!(
		pointSettingsRaw.tutorial_started_at || pointSettingsRaw.tutorial_banner_dismissed
	);

	return { pointSettings, authMode, tenantStatus, isPremium, planTier, tutorialStarted };
};
