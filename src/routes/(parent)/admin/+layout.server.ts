import { redirect } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { CurrencyCode, PointSettings, PointUnitMode } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { getEnv } from '$lib/runtime/env';
import { getAuthMode, isCognitoDevMode, requireTenantId } from '$lib/server/auth/factory';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { getSettings } from '$lib/server/db/settings-repo';
import { getDebugPlanSummary } from '$lib/server/debug-plan';
import { logger } from '$lib/server/logger';
import { getGracePeriodStatus } from '$lib/server/services/grace-period-service';
import {
	getOnboardingProgress,
	type OnboardingProgress,
} from '$lib/server/services/onboarding-service';
import {
	PARENT_SESSION_COOKIE_NAME,
	refreshParentSession,
	verifyParentSession,
} from '$lib/server/services/parent-gate-session';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import {
	archiveExcessResources,
	getArchivedResourceSummary,
} from '$lib/server/services/resource-archive-service';
import { getTrialStatus } from '$lib/server/services/trial-service';
import type { LayoutServerLoad } from './$types';

const TRIAL_WAS_ACTIVE_COOKIE = 'trial_was_active';

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
export const load: LayoutServerLoad = async ({ locals, cookies, url }) => {
	const tenantId = requireTenantId(locals);
	const authMode = getAuthMode();

	// EPIC #2310 子#2311: PIN gate middleware (Apple Screen Time 同設計)
	// `/admin/*` への到達には親 PIN session が必要。未認証 / 失効時は /switch?pinRequired=1&next=... へ redirect
	// 詳細: ADR-0050 + docs/design/14-セキュリティ設計書.md §親 PIN gate
	//
	// 有効化条件: cognito production モードのみ
	//   - anonymous mode (demo Lambda、ADR-0048): PIN gate 無効 (demo 環境では PIN 機構自体が無意味)
	//   - local mode (dev / NUC セルフホスト): PIN gate 無効 (Pre-PMF Bucket B、認証なしの開発者用途)
	//   - cognito-dev mode (COGNITO_DEV_MODE=true): PIN gate 無効 (E2E setup / DEV_USERS 経由のため、既存 E2E 全 spec の認証フローを破壊しない)
	//   - cognito production mode: PIN gate 有効 (同端末共有家庭の構造的 privacy 保護)
	//
	// cognito-dev で手動動作確認したい場合は `PARENT_GATE_FORCE_ACTIVE=true` env で強制 ON。
	const forceActive = getEnv().PARENT_GATE_FORCE_ACTIVE === true;
	const pinGateActive = forceActive || (authMode === 'cognito' && !isCognitoDevMode());
	const sessionCookie = cookies.get(PARENT_SESSION_COOKIE_NAME);
	if (pinGateActive && !verifyParentSession(sessionCookie, tenantId)) {
		const nextPath = url.pathname + (url.search ?? '');
		const redirectUrl = `/switch?pinRequired=1&next=${encodeURIComponent(nextPath)}`;
		redirect(303, redirectUrl);
	}

	// sliding refresh: lastActiveAt 更新 → 再 sign して cookie 再発行 (15 分 inactivity timeout 延長)
	if (pinGateActive && sessionCookie) {
		const refreshed = refreshParentSession(sessionCookie);
		if (refreshed) {
			cookies.set(PARENT_SESSION_COOKIE_NAME, refreshed, {
				path: '/',
				httpOnly: true,
				secure: COOKIE_SECURE,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24,
			});
		}
	}

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

	const tenantStatus = locals.context?.tenantStatus ?? SUBSCRIPTION_STATUS.ACTIVE;
	// #732: server load 全体で resolveFullPlanTier に統一。
	// trial 期限・tier は resolveFullPlanTier が内部で取得する（#725 の両引数漏れも自動解消）。
	const planTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
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

	// #1781: 解約後グレースピリオド状態（settings 画面で「あと N 日 / 復元」UI を出すため）
	const gracePeriodStatus = await getGracePeriodStatus(tenantId);

	// #2821: setup 由来の admin 遷移 (`?from=setup`) で文脈バナーを出すための onboarding 進捗。
	// 「みんなのテンプレートから追加 → 活動管理に着地 → setup 文脈消失」の迷子を防ぐ。
	// query が無ければ取得もしない (運用期の admin 通常利用に I/O を足さない)。
	// 完了済み (allCompleted) なら banner 側で描画されないため、文脈バナーも自然に消える。
	// admin home (`/admin` 自体) は OnboardingChecklist が既に出るため文脈バナーは重複回避で出さない。
	const fromSetup = url.searchParams.get('from') === 'setup' && url.pathname !== '/admin';
	let setupOnboarding: OnboardingProgress | null = null;
	if (fromSetup) {
		try {
			setupOnboarding = await getOnboardingProgress(tenantId, '/admin');
		} catch {
			setupOnboarding = null;
		}
	}

	return {
		pointSettings,
		authMode,
		// parent-gate inactivity redirect (client): PIN gate 有効時のみ admin で
		// 15 分アイドル → /switch 自動リダイレクトを起動する (dev/demo では起動しない)
		pinGateActive,
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
		gracePeriodStatus,
		// #2821: setup 由来遷移時のみ非 null。admin +layout.svelte が文脈バナーに使う。
		setupOnboarding,
		// EPIC #2327 / #2328: locals.runtimeMode を全 admin route の client data に配布。
		// hooks.server.ts (307 行) で全リクエストに注入済みの ADR-0040 SSOT (`nuc-prod` /
		// `aws-prod` / `local-debug` / `demo` / `build`) を UI 層に橋渡し。
		// /admin/subscription での NucLicensePanel / SaasLicensePanel 2 分岐に使用するほか、
		// 将来的に他 admin route の NUC/SaaS 分岐が必要になった際の SSOT 起点となる。
		runtimeMode: locals.runtimeMode,
	};
};
