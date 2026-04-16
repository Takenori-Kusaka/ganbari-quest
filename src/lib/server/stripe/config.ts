// src/lib/server/stripe/config.ts
// Stripe 決済設定・プラン定義 (#0131, #0271)

import { LICENSE_PLAN, type LicensePlan } from '$lib/domain/constants/license-plan';

/** Stripe で購入可能なプラン (lifetime は Stripe サブスク対象外) */
export type PlanId = Exclude<LicensePlan, typeof LICENSE_PLAN.LIFETIME>;

export interface PlanConfig {
	priceId: string;
	amount: number;
	interval: 'month' | 'year';
	tier: 'standard' | 'family';
	label: string;
}

/** 環境変数から Price ID を取得し、プラン設定を構築 */
function buildPlanConfigs(): Record<PlanId, PlanConfig> {
	return {
		[LICENSE_PLAN.MONTHLY]: {
			priceId: process.env.STRIPE_PRICE_MONTHLY ?? '',
			amount: 500,
			interval: 'month',
			tier: 'standard',
			label: 'スタンダード月額（¥500/月）',
		},
		[LICENSE_PLAN.YEARLY]: {
			priceId: process.env.STRIPE_PRICE_YEARLY ?? '',
			amount: 5000,
			interval: 'year',
			tier: 'standard',
			label: 'スタンダード年額（¥5,000/年）',
		},
		[LICENSE_PLAN.FAMILY_MONTHLY]: {
			priceId: process.env.STRIPE_PRICE_FAMILY_MONTHLY ?? '',
			amount: 780,
			interval: 'month',
			tier: 'family',
			label: 'ファミリー月額（¥780/月）',
		},
		[LICENSE_PLAN.FAMILY_YEARLY]: {
			priceId: process.env.STRIPE_PRICE_FAMILY_YEARLY ?? '',
			amount: 7800,
			interval: 'year',
			tier: 'family',
			label: 'ファミリー年額（¥7,800/年）',
		},
	};
}

let _plans: Record<PlanId, PlanConfig> | null = null;

/** プラン設定を取得（遅延初期化） */
export function getPlans(): Record<PlanId, PlanConfig> {
	if (!_plans) {
		_plans = buildPlanConfigs();
	}
	return _plans;
}

/** Price ID からプラン種別を逆引き */
export function planIdFromPriceId(priceId: string): PlanId | null {
	const plans = getPlans();
	for (const [id, config] of Object.entries(plans)) {
		if (config.priceId === priceId) return id as PlanId;
	}
	return null;
}

/** 無料トライアル日数 */
export const TRIAL_PERIOD_DAYS = 7;

/** 支払い失敗後の猶予期間（日数） */
export const GRACE_PERIOD_DAYS = 7;

/** 通貨 */
export const CURRENCY = 'jpy';

/** Webhook 署名シークレット */
export function getWebhookSecret(): string {
	const secret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!secret) {
		throw new Error('STRIPE_WEBHOOK_SECRET must be set');
	}
	return secret;
}
