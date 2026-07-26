// src/lib/domain/constants/plan-tier.ts
// プランティア (機能制限の粒度) の型 SSOT。
//
// `SubscriptionPlan` (subscription-plan.ts) が「Stripe 上の課金プラン値」であるのに対し、
// `PlanTier` は「機能制限をどの段で適用するか」を表す。monthly / yearly は同じ standard
// ティアに畳まれるため、両者は 1:1 ではない。
//
// #3963: 型宣言を domain leaf に置くのは、`request-context.ts` が cache の値型として
// `PlanTier` を必要とする一方で、実装を持つ `plan-limit-service.ts` は
// `request-context.ts` を import するため、実装 module に型を置くと循環になるため
// (depcruise は tsPreCompilationDeps: true なので type-only import も循環に数える)。
// 実装 (PLAN_LIMITS / resolveFullPlanTier) は従来どおり plan-limit-service.ts が持つ。

export type PlanTier = 'free' | 'standard' | 'family';
