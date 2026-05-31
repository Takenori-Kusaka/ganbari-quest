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
			label: `${PLAN_TERMS.premium}月額（${PRICE_TERMS.family}/月）`,
		},
		[LICENSE_PLAN.FAMILY_YEARLY]: {
			priceId: process.env.STRIPE_PRICE_FAMILY_YEARLY ?? '',
			amount: 7800,
			interval: 'year',
			tier: 'family',
			label: `${PLAN_TERMS.premium}年額（¥7,800/年）`,
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

/**
 * Webhook shadow mode 用署名シークレット (Phase 7 PR-4a / Issue #2713 / ADR-0059)
 *
 * Test mode で新規 Webhook destination (#2627) を作成した際の signing secret。
 * shadow mode (`STRIPE_WEBHOOK_SHADOW_MODE=true`) では `STRIPE_WEBHOOK_SECRET_TEST`
 * を優先し、未設定なら本番 `STRIPE_WEBHOOK_SECRET` に fallback する。
 *
 * 設計 SSOT: docs/decisions/0059-phase7-cutover-sequence.md §「結果」
 * 関連 docs: docs/design/billing-redesign/phase6-phase7-execution-ssot.md §3 Step 4-a
 */
export function getWebhookSecretForShadow(): string {
	const secret = process.env.STRIPE_WEBHOOK_SECRET_TEST ?? process.env.STRIPE_WEBHOOK_SECRET;
	if (!secret) {
		throw new Error(
			'STRIPE_WEBHOOK_SECRET_TEST or STRIPE_WEBHOOK_SECRET must be set for shadow mode',
		);
	}
	return secret;
}

/**
 * Webhook shadow mode feature flag (Phase 7 PR-4a / Issue #2713 / ADR-0059)
 *
 * `STRIPE_WEBHOOK_SHADOW_MODE=true` の場合のみ true を返す。それ以外 (未設定 /
 * `'false'` / `''` / 任意の他文字列) は false。
 *
 * Stripe 公式 5 phase migration (setup → discovery → shadow → cutover → retire)
 * の **shadow phase** (Phase 7 Step 4-a) で 24-48h log only 検証する際に
 * `true` に切替える kill switch。次の AWS Lambda invocation (約 30 秒) で反映される。
 *
 * 設計 SSOT: docs/decisions/0059-phase7-cutover-sequence.md §「結果」
 * 関連 docs: docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §S6
 */
export function isWebhookShadowModeEnabled(): boolean {
	return process.env.STRIPE_WEBHOOK_SHADOW_MODE === 'true';
}
