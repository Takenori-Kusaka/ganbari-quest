// /admin/subscription — サブスクリプション管理ページ (#0130, #0131, #314)
//
// Epic #2525 Phase 7 PR-L3 (#2818): 旧 /admin/license から rename。
// license key 全廃 (Phase 1 補強 3 #2788) に伴い `applyLicenseKey` action +
// license-key-service 依存 (consumeLicenseKey / validateLicenseKey / checkLicenseKeyRateLimit /
// restoreArchivedResources) を撤去。subscription 管理 (プラン表示 / trial / Stripe 連携) のみ残す。

import { fail } from '@sveltejs/kit';
// #3669: 活動カウンタは quota (checkActivityLimit) と同一の SSOT 述語で集計する
// (旧実装は 'parent' を数えており、producer/quota と三重乖離して常に 0 表示だった)
import { countsTowardActivityQuota } from '$lib/domain/activity-source';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import {
	isPortalFallbackContext,
	isPortalFallbackReason,
	PORTAL_FALLBACK_PARAM,
	PORTAL_FALLBACK_REASON,
	PORTAL_FALLBACK_REASON_PARAM,
} from '$lib/domain/constants/stripe-portal';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { TRIAL_LABELS } from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import { resolveTenantEntitlement } from '$lib/server/auth/tenant-entitlement';
import { getActivities } from '$lib/server/services/activity-service';
import { isPinConfigured } from '$lib/server/services/auth-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { getLoyaltyInfo } from '$lib/server/services/loyalty-service';
import { getPlanLimits, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import {
	getCancellationState,
	reconcileCheckoutSession,
} from '$lib/server/services/stripe-service';
import { getTrialStatus, startTrial } from '$lib/server/services/trial-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);

	// #3958: Stripe checkout の success_url は `?session_id=cs_…` を付けてこの画面に戻る。
	// webhook (`checkout.session.completed`) が未達でも、この照合だけでプランが反映される
	// (webhook が唯一の反映経路だった頃は、1 通落ちるだけで顧客が永久に無料プランのまま
	// だった — 2026-07-26 本番 incident)。他の load より先に await して、下の
	// `getLicenseInfo` / `resolveFullPlanTier` が反映後の状態を読むようにする。
	const sessionId = url.searchParams.get('session_id');
	const checkoutReconciliation = sessionId
		? await reconcileCheckoutSession({ tenantId, sessionId })
		: null;

	const [license, loyaltyInfo, children, trialStatus, pinConfigured, cancellation] =
		await Promise.all([
			getLicenseInfo(tenantId),
			getLoyaltyInfo(tenantId).catch(() => null),
			getAllChildren(tenantId),
			getTrialStatus(tenantId),
			isPinConfigured(tenantId),
			// #3991: 「解約申請中か」「いつまで使えるか」の SSOT は Stripe の subscription (NFR-2)。
			// DB に猶予期限を持たせると `grace_period` (dunning) と再び多重定義になる (#3986) ため、
			// 本画面を開いたときに都度取得する (subscription 画面限定 = 低頻度、admin layout には載せない)。
			// Stripe 障害でプラン画面全体が 500 にならないよう、失敗時は null に落として表示だけ諦める。
			getCancellationState(tenantId).catch(() => null),
		]);

	// プラン利用状況 (#732: resolveFullPlanTier に統一)
	// #3958: `locals.context` は hooks.server.ts が load 前に解決した値なので、本 request 内で
	// reconcile が契約を反映した場合は古い (無料プランのまま)。反映したときだけ DB から
	// 引き直す (reconcile 側が request キャッシュを破棄済みなので最新値が返る)。
	const entitlement =
		checkoutReconciliation?.status === 'applied'
			? await resolveTenantEntitlement(tenantId)
			: {
					licenseStatus: locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
					plan: locals.context?.plan,
				};
	const tier = await resolveFullPlanTier(tenantId, entitlement.licenseStatus, entitlement.plan);
	const planLimits = getPlanLimits(tier);
	let activityCount = 0;
	try {
		const acts = await getActivities(tenantId, { includeHidden: false });
		activityCount = acts.filter((a) => countsTowardActivityQuota(a.source)).length;
	} catch {
		/* fallback */
	}
	const planStats = {
		activityCount,
		activityMax: planLimits.maxActivities,
		childCount: children.length,
		childMax: planLimits.maxChildren,
		retentionDays: planLimits.historyRetentionDays,
	};

	// #736: 解約時のダウングレード先（常に free プラン）の保持期間を PLAN_LIMITS から取得。
	// null = 無制限（現状 free は 90 だが、将来変更されても自動追従する）。
	const downgradeRetentionDays = getPlanLimits('free').historyRetentionDays;

	return {
		license: license ?? {
			plan: 'free' as const,
			status: SUBSCRIPTION_STATUS.ACTIVE,
			tenantName: '',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
		stripeEnabled: isStripeEnabled(),
		loyaltyInfo,
		planTier: tier,
		planStats,
		downgradeRetentionDays,
		pinConfigured,
		// #3958: null = success_url 経由ではない通常表示。値があるときだけ画面に結果を出す。
		checkoutReconciliation,
		// #4270: portal の flow が Stripe に拒否されて home に倒れたときだけ値が入る。
		// 画面は「次にどこで手続きを続けるか」を出す (原因は説明しない、ADR-0062)。
		portalFallback: (() => {
			const raw = url.searchParams.get(PORTAL_FALLBACK_PARAM);
			return isPortalFallbackContext(raw) ? raw : null;
		})(),
		// #4548: **なぜ**倒れたか。一時障害 (再試行で直りうる) と、ご契約情報が確認できない
		// 恒久不能 (何度押しても同じ) では顧客が次に取るべき行動が正反対で、後者は
		// サポート窓口が唯一の出口になる。値が読めないときは一時障害側に倒す
		// (誤ってサポートへ誘導するより、再試行を促すほうが害が小さい)。
		portalFallbackReason: (() => {
			const raw = url.searchParams.get(PORTAL_FALLBACK_REASON_PARAM);
			return isPortalFallbackReason(raw) ? raw : PORTAL_FALLBACK_REASON.FLOW_REJECTED;
		})(),
		trialStatus: {
			isTrialActive: trialStatus.isTrialActive,
			trialUsed: trialStatus.trialUsed,
			daysRemaining: trialStatus.daysRemaining,
			trialEndDate: trialStatus.trialEndDate,
			trialTier: trialStatus.trialTier,
		},
		// #3991: 期末解約の予約状態 (null = 契約なし / Stripe 未設定 / 取得失敗)
		cancellation,
		// EPIC #2327 / #2328: runtimeMode は +layout.server.ts (admin layout) で
		// 全 admin route の data に配布済み。NucLicensePanel / SaasLicensePanel の
		// 分岐に使用する (#2329 / #2330 / #2331)。
	};
};

export const actions: Actions = {
	startTrial: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		const started = await startTrial({
			tenantId,
			source: 'user_initiated',
			tier: 'standard',
		});

		if (!started) {
			// #2941 項目 2: メッセージは TRIAL_LABELS SSOT 経由。SaasLicensePanel の startTrial form
			// (#3033 で開始導線を一本化) が getActionErrorDisplay でユーザーに見える形で表示する (NN/G #1)
			return fail(400, { error: TRIAL_LABELS.startErrorAlreadyUsed });
		}

		return { success: true };
	},
};
