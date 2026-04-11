// /admin/license — ライセンス管理画面 (#0130, #0131, #314, #796)

import { fail } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { requireRole } from '$lib/server/auth/guards';
import { logger } from '$lib/server/logger';
import { getActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { consumeLicenseKey, validateLicenseKey } from '$lib/server/services/license-key-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { getLoyaltyInfo } from '$lib/server/services/loyalty-service';
import { getPlanLimits, resolvePlanTier } from '$lib/server/services/plan-limit-service';
import { getTrialStatus, startTrial } from '$lib/server/services/trial-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const [license, loyaltyInfo, children, trialStatus] = await Promise.all([
		getLicenseInfo(tenantId),
		getLoyaltyInfo(tenantId).catch(() => null),
		getAllChildren(tenantId),
		getTrialStatus(tenantId),
	]);

	// プラン利用状況
	const tier = resolvePlanTier(
		locals.context?.licenseStatus ?? 'none',
		locals.context?.plan,
		trialStatus.isTrialActive ? trialStatus.trialEndDate : null,
		trialStatus.isTrialActive ? trialStatus.trialTier : null,
	);
	const planLimits = getPlanLimits(tier);
	let activityCount = 0;
	try {
		const acts = await getActivities(tenantId, { includeHidden: false });
		activityCount = acts.filter((a) => a.source === 'parent').length;
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
			status: 'active' as const,
			tenantName: '',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
		stripeEnabled: isStripeEnabled(),
		loyaltyInfo,
		planTier: tier,
		planStats,
		downgradeRetentionDays,
		trialStatus: {
			isTrialActive: trialStatus.isTrialActive,
			trialUsed: trialStatus.trialUsed,
			daysRemaining: trialStatus.daysRemaining,
			trialEndDate: trialStatus.trialEndDate,
			trialTier: trialStatus.trialTier,
		},
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
			return fail(400, { error: 'トライアルはすでに使用済みです' });
		}

		return { success: true };
	},

	/**
	 * ライセンスキーを既存テナントに適用する (#796)
	 *
	 * 経路: /admin/license で入力 → 確認ダイアログ → このアクション → consumeLicenseKey
	 *
	 * - owner ロールのみ実行可能（parent/child は 403）— キーは一回限り使用で tenant の
	 *   プラン状態を変えるため、権限者の意思決定であるべき
	 * - signup 時の consume と異なり、既に tenant が存在する状態で呼び出される
	 * - consumeLicenseKey が tenant plan を昇格し、license を consumed にマークする
	 * - 成功時は `success: true` + 新プラン情報を返し、UI が data をリロードして反映
	 */
	applyLicenseKey: async ({ locals, request }) => {
		requireRole(locals, ['owner']);
		const tenantId = requireTenantId(locals);

		const formData = await request.formData();
		const rawKey = (formData.get('licenseKey') as string | null)?.trim() ?? '';

		if (!rawKey) {
			return fail(400, { apply: { error: 'ライセンスキーを入力してください' } });
		}

		// 事前検証: 形式・存在・状態チェック（失敗時は consume を試行しない）
		const check = await validateLicenseKey(rawKey);
		if (!check.valid) {
			return fail(400, { apply: { error: check.reason, licenseKey: rawKey } });
		}

		try {
			const result = await consumeLicenseKey(rawKey, tenantId);
			if (!result.ok) {
				logger.warn('[LICENSE-APPLY] consumeLicenseKey rejected', {
					context: { reason: result.reason, tenantId, keyPrefix: rawKey.slice(0, 7) },
				});
				return fail(400, { apply: { error: result.reason, licenseKey: rawKey } });
			}

			logger.info('[LICENSE-APPLY] Key applied to existing tenant', {
				context: {
					tenantId,
					plan: result.plan,
					planExpiresAt: result.planExpiresAt ?? 'never',
				},
			});

			return {
				apply: {
					success: true,
					plan: result.plan,
					planExpiresAt: result.planExpiresAt,
				},
			};
		} catch (err) {
			logger.error('[LICENSE-APPLY] consumeLicenseKey threw', {
				context: {
					error: err instanceof Error ? err.message : String(err),
					tenantId,
					keyPrefix: rawKey.slice(0, 7),
				},
			});
			return fail(500, {
				apply: {
					error: 'ライセンスキーの適用に失敗しました。しばらくしてから再度お試しください。',
				},
			});
		}
	},
};
