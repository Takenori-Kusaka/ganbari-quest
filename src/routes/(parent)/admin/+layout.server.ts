import type { CurrencyCode, PointSettings, PointUnitMode } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { getAuthMode, requireTenantId } from '$lib/server/auth/factory';
import { getSettings } from '$lib/server/db/settings-repo';
import { isPaidTier, resolvePlanTier } from '$lib/server/services/plan-limit-service';
import { getTrialStatus } from '$lib/server/services/trial-service';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const authMode = getAuthMode();

	const [pointSettingsRaw, trialStatus] = await Promise.all([
		getSettings(
			[
				'point_unit_mode',
				'point_currency',
				'point_rate',
				'tutorial_started_at',
				'tutorial_banner_dismissed',
			],
			tenantId,
		),
		getTrialStatus(tenantId),
	]);
	const pointSettings: PointSettings = {
		mode: (pointSettingsRaw.point_unit_mode as PointUnitMode) ?? DEFAULT_POINT_SETTINGS.mode,
		currency: (pointSettingsRaw.point_currency as CurrencyCode) ?? DEFAULT_POINT_SETTINGS.currency,
		rate: Number.parseFloat(pointSettingsRaw.point_rate ?? '') || DEFAULT_POINT_SETTINGS.rate,
	};

	const tenantStatus = locals.context?.tenantStatus ?? 'active';
	const planTier = resolvePlanTier(
		locals.context?.licenseStatus ?? 'none',
		locals.context?.plan,
		trialStatus.trialEndDate,
	);
	const isPremium = isPaidTier(planTier);
	const tutorialStarted = !!(
		pointSettingsRaw.tutorial_started_at || pointSettingsRaw.tutorial_banner_dismissed
	);

	const userRole = locals.context?.role ?? 'owner';

	return {
		pointSettings,
		authMode,
		tenantStatus,
		isPremium,
		planTier,
		tutorialStarted,
		userRole,
		trialStatus: {
			isTrialActive: trialStatus.isTrialActive,
			daysRemaining: trialStatus.daysRemaining,
			trialUsed: trialStatus.trialUsed,
			trialEndDate: trialStatus.trialEndDate,
		},
	};
};
