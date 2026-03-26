// src/lib/server/stripe/config.ts
// Stripe 決済設定・プラン定義 (#0131)

export type PlanId = 'monthly' | 'yearly';

export interface PlanConfig {
	priceId: string;
	amount: number;
	interval: 'month' | 'year';
	label: string;
}

/** 環境変数から Price ID を取得し、プラン設定を構築 */
function buildPlanConfigs(): Record<PlanId, PlanConfig> {
	return {
		monthly: {
			priceId: process.env.STRIPE_PRICE_MONTHLY ?? '',
			amount: 500,
			interval: 'month',
			label: '月額プラン（¥500/月）',
		},
		yearly: {
			priceId: process.env.STRIPE_PRICE_YEARLY ?? '',
			amount: 5000,
			interval: 'year',
			label: '年額プラン（¥5,000/年）',
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
