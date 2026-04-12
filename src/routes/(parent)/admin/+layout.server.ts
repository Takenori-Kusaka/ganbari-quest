import type { CurrencyCode, PointSettings, PointUnitMode } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { getAuthMode, requireTenantId } from '$lib/server/auth/factory';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { getSettings } from '$lib/server/db/settings-repo';
import { getDebugPlanSummary } from '$lib/server/debug-plan';
import { logger } from '$lib/server/logger';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import {
	archiveExcessResources,
	getArchivedResourceSummary,
} from '$lib/server/services/resource-archive-service';
import { getTrialStatus } from '$lib/server/services/trial-service';
import type { LayoutServerLoad } from './$types';

const TRIAL_WAS_ACTIVE_COOKIE = 'trial_was_active';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
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
	// #732: server load 全体で resolveFullPlanTier に統一。
	// trial 期限・tier は resolveFullPlanTier が内部で取得する（#725 の両引数漏れも自動解消）。
	const planTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? 'none',
		locals.context?.plan,
	);
	const isPremium = isPaidTier(planTier);
	const tutorialStarted = !!(
		pointSettingsRaw.tutorial_started_at || pointSettingsRaw.tutorial_banner_dismissed
	);

	const userRole = locals.context?.role ?? 'owner';

	// #770: トライアル終了検知 — cookie で前回の trial 状態を記憶し、
	// active → inactive の遷移を検出したら trialJustExpired フラグを立てる。
	const wasTrialActive = cookies.get(TRIAL_WAS_ACTIVE_COOKIE) === '1';
	const trialJustExpired = wasTrialActive && !trialStatus.isTrialActive;

	if (trialStatus.isTrialActive) {
		// トライアル中は cookie を維持（30日有効 — トライアルの最長期間を超える）
		cookies.set(TRIAL_WAS_ACTIVE_COOKIE, '1', {
			path: '/',
			httpOnly: true,
			secure: COOKIE_SECURE,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30,
		});
	} else if (trialJustExpired) {
		// 遷移検知後に cookie を削除（次回リクエストでは trialJustExpired=false になる）
		cookies.delete(TRIAL_WAS_ACTIVE_COOKIE, { path: '/', secure: COOKIE_SECURE });
	}

	// #783: トライアル終了後に free プランの上限を超えるリソースを archive する。
	// 冪等: 既に archive 済みなら超過はなく何もしない。
	const isTrialExpired = trialStatus.trialUsed && !trialStatus.isTrialActive;
	if (planTier === 'free' && isTrialExpired) {
		try {
			const result = await archiveExcessResources(tenantId);
			if (
				result.archivedChildIds.length > 0 ||
				result.archivedActivityIds.length > 0 ||
				result.archivedChecklistTemplateIds.length > 0
			) {
				logger.info('[ARCHIVE] Trial expired — excess resources archived', {
					context: {
						tenantId,
						children: result.archivedChildIds.length,
						activities: result.archivedActivityIds.length,
						checklists: result.archivedChecklistTemplateIds.length,
					},
				});
			}
		} catch (err) {
			logger.error('[ARCHIVE] Failed to archive excess resources', {
				context: { tenantId, error: err instanceof Error ? err.message : String(err) },
			});
		}
	}

	// #783: archive 済みリソースの概要（UI 表示用）
	const archivedSummary =
		planTier === 'free' && isTrialExpired
			? await getArchivedResourceSummary(tenantId)
			: { archivedChildCount: 0, hasArchivedResources: false };


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
		trialJustExpired,
		archivedSummary,
		debugPlanSummary: getDebugPlanSummary(),
	};
};
