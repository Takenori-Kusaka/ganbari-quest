// src/lib/server/stripe/config.ts
// Stripe 決済設定・プラン定義 (#0131, #0271)
//
// プラン名 / 価格 atom SSOT: src/lib/domain/terms.ts (PLAN_TERMS / PRICE_TERMS)
// 関連: #1918 Phase 5 F1 (リテラル直書き禁止 CI 強化) / ADR-0045 terms.ts 2 階層 SSOT

import { LICENSE_PLAN, type LicensePlan } from '$lib/domain/constants/license-plan';
import { PLAN_TERMS, PRICE_TERMS } from '$lib/domain/terms';

/** Stripe で購入可能なプラン (lifetime は Stripe サブスク対象外) */
export type PlanId = Exclude<LicensePlan, typeof LICENSE_PLAN.LIFETIME>;

export interface PlanConfig {
	priceId: string;
	amount: number;
	interval: 'month' | 'year';
	tier: 'standard' | 'family';
	label: string;
}

/**
 * 環境変数から Price ID を取得し、プラン設定を構築。
 *
 * #2347 (EPIC #2345): 設計書 SSOT (docs/design/19-プライシング戦略書.md /
 * 21-プラン用語統一規約.md / plan-change-flow.md) の名称
 * `STRIPE_PRICE_STANDARD_MONTHLY` / `STRIPE_PRICE_STANDARD_YEARLY` を優先しつつ、
 * 旧名 `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` を fallback として継続許容。
 *
 * production env (CDK / GitHub Secrets) に既配布済の旧名を破壊しないことと、
 * 設計書 SSOT 整合の両立を満たすため新名優先 + 旧名 fallback 方式を採用。
 * 旧名は将来別 PR でリネーム完了後に削除予定 (#2347 follow-up)。
 *
 * 4 種別の interval × tier 対応:
 *   - STANDARD_MONTHLY  (旧: STRIPE_PRICE_MONTHLY)
 *   - STANDARD_YEARLY   (旧: STRIPE_PRICE_YEARLY)
 *   - FAMILY_MONTHLY    (リネームなし)
 *   - FAMILY_YEARLY     (リネームなし)
 */
function buildPlanConfigs(): Record<PlanId, PlanConfig> {
	return {
		[LICENSE_PLAN.MONTHLY]: {
			priceId: process.env.STRIPE_PRICE_STANDARD_MONTHLY ?? process.env.STRIPE_PRICE_MONTHLY ?? '',
			amount: 500,
			interval: 'month',
			tier: 'standard',
			label: `${PLAN_TERMS.standard}月額（${PRICE_TERMS.standard}/月）`,
		},
		[LICENSE_PLAN.YEARLY]: {
			priceId: process.env.STRIPE_PRICE_STANDARD_YEARLY ?? process.env.STRIPE_PRICE_YEARLY ?? '',
			amount: 5000,
			interval: 'year',
			tier: 'standard',
			label: `${PLAN_TERMS.standard}年額（¥5,000/年）`,
		},
		[LICENSE_PLAN.FAMILY_MONTHLY]: {
			priceId: process.env.STRIPE_PRICE_FAMILY_MONTHLY ?? '',
			amount: 780,
			interval: 'month',
			tier: 'family',
			label: `${PLAN_TERMS.family}月額（${PRICE_TERMS.family}/月）`,
		},
		[LICENSE_PLAN.FAMILY_YEARLY]: {
			priceId: process.env.STRIPE_PRICE_FAMILY_YEARLY ?? '',
			amount: 7800,
			interval: 'year',
			tier: 'family',
			label: `${PLAN_TERMS.family}年額（¥7,800/年）`,
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
