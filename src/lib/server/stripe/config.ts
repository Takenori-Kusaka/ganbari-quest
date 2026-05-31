// src/lib/server/stripe/config.ts
// Stripe 決済設定・プラン定義 (#0131, #0271)
//
// プラン名 / 価格 atom SSOT: src/lib/domain/terms.ts (PLAN_TERMS / PRICE_TERMS)
// 関連: #1918 Phase 5 F1 (リテラル直書き禁止 CI 強化) / ADR-0045 terms.ts 2 階層 SSOT

import { LICENSE_PLAN, type LicensePlan } from '$lib/domain/constants/license-plan';
import { PLAN_TERMS, PRICE_TERMS } from '$lib/domain/terms';
import { notifyStripeAlert } from './alert';
import { getPriceByLookupKey, type LookupKey } from './price-cache';

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

/**
 * lookup_key 経路 feature flag (Phase 7 PR-3a / Issue #2716 / ADR-0059)
 *
 * `USE_LOOKUP_KEY=true` の場合のみ true を返す。それ以外 (未設定 /
 * `'false'` / `''` / 任意の他文字列) は false。
 *
 * Stripe 公式 `transfer_lookup_key` 4 step migration の **Step 2 (並行運用)** で
 * 旧 env var (`STRIPE_PRICE_*` 4 件) と新 lookup_key (`standard_monthly` /
 * `premium_monthly`) を並行運用する kill switch。
 *
 * 本 PR (PR-3a) では default `false` で env 配備 + 関数経由化のみ。実際の cutover
 * (`USE_LOOKUP_KEY=true` 切替 + Production 物理配備) は PR-3b で実施する。
 * 次の AWS Lambda invocation (約 30 秒) で反映される。
 *
 * 設計 SSOT: docs/decisions/0059-phase7-cutover-sequence.md §「結果」§2 kill switch
 * 関連 docs: docs/design/billing-redesign/phase6-context-decisions-6.md §4.3 並行運用
 *           / docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §S6
 */
export function isLookupKeyEnabled(): boolean {
	return process.env.USE_LOOKUP_KEY === 'true';
}

/**
 * Phase 7 PR-3a / Issue #2716: plan + interval から Stripe Price ID を解決する関数経由化。
 *
 * `USE_LOOKUP_KEY` flag による並行運用切替を集約。本 PR では既存呼出箇所を関数経由化
 * (動作変更なし、default `false` で env var 直読を維持) し、PR-3b cutover で env var
 * 直読撤廃の準備を整える。
 *
 * 動作:
 * - `USE_LOOKUP_KEY=true`: caching 経由で lookup_key → priceId 解決。Stripe API 障害時は
 *   env var fallback (kill switch、context-decisions-6 §4.1 Step 2 並行運用)
 * - `USE_LOOKUP_KEY=false` (default): env var 直読 (`STRIPE_PRICE_STANDARD_MONTHLY` 等 4 種、
 *   既存 `buildPlanConfigs()` と同経路 + 旧名 fallback 整合 #2347)
 *
 * @param plan - プラン種別 (`'standard'` / `'premium'`)
 * @param interval - 課金周期 (`'monthly'`、yearly は PR-3b 以降で追加)
 * @returns 解決された Price ID
 * @throws lookup_key / env var 双方未解決の場合 (`MISSING_PRICE_ID`)
 *
 * 設計 SSOT:
 *   - docs/design/billing-redesign/phase6-context-decisions-6.md §4 lookup_key 段階移行
 *   - docs/decisions/0059-phase7-cutover-sequence.md §「結果」§1 Step 3
 *
 * @example
 *   const priceId = await getPriceId('standard', 'monthly');
 *   // → 'price_1Abc...' (`USE_LOOKUP_KEY=true` なら lookup_key 経由、false なら env 経由)
 */
export async function getPriceId(
	plan: 'standard' | 'premium',
	interval: 'monthly',
): Promise<string> {
	// 1. 旧 env var (`STRIPE_PRICE_*` 4 件) を解決 (fallback / default 経路の SSOT)
	const envPriceId = resolveEnvPriceId(plan, interval);

	// 2. lookup_key flag OFF (default): env var 直読のみ (本番動作不変)
	if (!isLookupKeyEnabled()) {
		if (!envPriceId) {
			throw new Error(`MISSING_PRICE_ID: plan=${plan}, interval=${interval} (env var 未設定)`);
		}
		return envPriceId;
	}

	// 3. lookup_key flag ON: caching 経由で解決、失敗時 env var fallback (kill switch)
	const lookupKey: LookupKey = `${plan}_${interval}` as LookupKey;
	try {
		return await getPriceByLookupKey(lookupKey);
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		// Stripe API 障害 / Price 未発行 → env var fallback (kill switch、context-decisions-6 §4.3)
		if (envPriceId) {
			// #2720 Adversarial security 軸: silent degradation 防止。fallback 発動を観測可能化。
			// alert kind=stripe-lookup-failed は phase6-rollback-and-kill-switches.md §6 R4 SSOT。
			// fire-and-forget (課金 path をブロックしない、既存 license-key-service.ts L351 pattern 整合)。
			notifyStripeAlert({
				kind: 'stripe-lookup-failed',
				message: `lookup_key 解決失敗 → env var fallback 起動 (kill switch 動作、課金 path 継続)`,
				errorSummary: `lookup_failed:${lookupKey}:${errMsg.slice(0, 100)}`,
				tags: { plan, interval, lookupKey, fallbackUsed: true },
			});
			return envPriceId;
		}
		// 双方 NG → 致命: alert (level=error) + throw (caller で 5xx 返却)
		notifyStripeAlert({
			kind: 'stripe-lookup-failed',
			message: `lookup_key 解決失敗 + env var fallback も未設定 (致命、課金 path 停止)`,
			errorSummary: `missing_price_id:${lookupKey}:${errMsg.slice(0, 100)}`,
			tags: { plan, interval, lookupKey, fallbackUsed: false },
		});
		throw new Error(
			`MISSING_PRICE_ID: plan=${plan}, interval=${interval}, lookupKey=${lookupKey} ` +
				`(lookup_key 解決失敗 + env var fallback も未設定): ${errMsg}`,
		);
	}
}

/**
 * 内部: plan + interval から env var を直読する (旧経路 + 旧名 fallback、#2347 整合)。
 *
 * `buildPlanConfigs()` 内のロジックと同型。Phase 7 PR-3b cutover (env var 削除) 時に
 * `buildPlanConfigs()` ごと統合判断する想定。本 PR では `getPriceId()` の fallback 経路として
 * 切り出した (重複を避けるため private export 化せず module 内 helper として定義)。
 */
function resolveEnvPriceId(plan: 'standard' | 'premium', interval: 'monthly'): string | null {
	if (plan === 'standard' && interval === 'monthly') {
		return process.env.STRIPE_PRICE_STANDARD_MONTHLY ?? process.env.STRIPE_PRICE_MONTHLY ?? null;
	}
	if (plan === 'premium' && interval === 'monthly') {
		// premium = family (PLAN_TERMS.premium / .family は同値 'プレミアム'、ADR-0058 rename 過渡期)
		return process.env.STRIPE_PRICE_FAMILY_MONTHLY ?? null;
	}
	return null;
}
