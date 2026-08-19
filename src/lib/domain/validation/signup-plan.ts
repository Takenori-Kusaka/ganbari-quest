// src/lib/domain/validation/signup-plan.ts
// `/auth/signup?plan=` / `/pricing` CTA から引き継ぐトライアル対象プランの SSOT (#766 / #4702)。
//
// メール登録経路 (`?/confirm` action) と Google 登録経路 (`/auth/oauth/google` → cookie →
// `/auth/callback` → `/auth/oauth/trial-start`) が **同じ parse 規則**を使うための共有モジュール。
// 片方だけが plan を解釈すると「無料体験をはじめる」を押した顧客が登録手段によって無料プランに
// 着地する (#4702 症状 3)。

/** トライアルを自動開始できるプラン (trial-service の TrialTier と同値域)。 */
export const TRIAL_PLAN_VALUES = ['standard', 'family'] as const;
export type TrialPlanValue = (typeof TRIAL_PLAN_VALUES)[number];

/** Google 登録経路で `?plan=` を往復させる cookie 名 (`/auth/oauth/google` → `/auth/callback`)。 */
export const OAUTH_PLAN_COOKIE_NAME = 'oauth_plan';

/** OAuth 往復 cookie の寿命 (秒)。Google 側の同意画面を挟むため `oauth_next` と同じ 10 分。 */
export const OAUTH_PLAN_MAX_AGE_SECONDS = 600;

/**
 * `?plan=` の値をトライアル対象プランに正規化する。
 * 既知のティア以外 (無効値 / 空文字 / null) は null を返し、呼び出し側はトライアル開始を skip する。
 */
export function parsePlanForTrial(planInput: string | null | undefined): TrialPlanValue | null {
	if (!planInput) return null;
	const normalized = planInput.trim().toLowerCase();
	return (TRIAL_PLAN_VALUES as readonly string[]).includes(normalized)
		? (normalized as TrialPlanValue)
		: null;
}
