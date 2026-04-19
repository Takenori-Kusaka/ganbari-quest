/**
 * Policy Gate (ADR-0040 Phase 4 / #1217)
 *
 * 全ての機能ゲート判断を集約する純関数レイヤ。
 *
 * 位置付け:
 * - ADR-0040 §第 3 層（3 層アーキテクチャの最上層）
 * - 第 1 層 `env.ts` + 第 2 層 `evaluation-context.ts` の上で動く
 * - I/O 一切なし。`EvaluationContext` のみに依存
 *
 * 目的:
 * - UI / load / action / hooks / service に散在する機能ゲート判断を 1 箇所に集約
 * - 「この機能は何のモード × プランで使えるか」の SSOT を確立
 * - 新機能追加時のチェックリストを「この機能は何の capability か」の 1 問に集約
 *
 * 設計上の制約:
 * - `can()` は純関数。副作用なし、I/O なし、時刻参照は `ctx.now` 経由
 * - `ensureCan()` は SvelteKit の `error(403)` を throw する（route / action 先頭用）
 * - server→client に `Capability` 型や reason 文字列を全量露出しない（ADR-0009 教訓）
 *
 * スコープ外 (P4.1 以降):
 * - 既存の `event.locals.isDemo` / `resolvePlanTier` 分岐の全面置換
 * - UI の `{#if can(...).allowed}` 制御
 * - Playwright での mode × plan マトリクス（P5 #60）
 */

import { error } from '@sveltejs/kit';

import type { EvaluationContext } from '$lib/runtime/evaluation-context';

/**
 * 代表 10 capability。ADR-0040 Epic (#1202) §P4 に従う。
 *
 * 増減する場合は ADR-0040 §第 3 層 の code example も同期更新すること。
 */
export type Capability =
	| 'record.activity'
	| 'invite.family_member'
	| 'export.activity_history'
	| 'access.ops_dashboard'
	| 'purchase.upgrade'
	| 'write.db'
	| 'debug.plan_override'
	| 'view.ops_license_dashboard'
	| 'manage.child_profile'
	| 'redeem.license_key';

/**
 * Deny の理由。UI では i18n キーにマップして表示する想定（直接露出はしない）。
 */
export type DenyReason =
	| 'demo-readonly' // mode=demo は read-only
	| 'build-time-readonly' // SSR prerender 中は DB 書き込み禁止
	| 'unauthenticated' // user=null
	| 'role-insufficient' // role が要件を満たさない (owner/parent/child)
	| 'plan-tier-insufficient' // プランティアが要件を満たさない
	| 'license-key-invalid' // NUC モードでライセンスキー invalid
	| 'mode-mismatch' // capability が別モード専用
	| 'dev-only' // local-debug 専用
	| 'ops-only'; // Cognito groups に 'ops' が必要

export interface PolicyResult {
	allowed: boolean;
	reason?: DenyReason;
}

const ALLOW: PolicyResult = { allowed: true };
const deny = (reason: DenyReason): PolicyResult => ({ allowed: false, reason });

/**
 * 「この ctx で DB 書き込みができるか」の共通判定。
 * 複数 capability の前提条件として再利用する。
 */
function canWriteDb(ctx: EvaluationContext): PolicyResult {
	if (ctx.mode === 'demo') return deny('demo-readonly');
	if (ctx.mode === 'build') return deny('build-time-readonly');
	if (ctx.mode === 'nuc-prod' && !ctx.licenseKey?.valid) return deny('license-key-invalid');
	return ALLOW;
}

type CapabilityEvaluator = (ctx: EvaluationContext) => PolicyResult;

const evaluators: Record<Capability, CapabilityEvaluator> = {
	'write.db': canWriteDb,

	'record.activity': (ctx) => {
		if (!ctx.user) return deny('unauthenticated');
		return canWriteDb(ctx);
	},

	'invite.family_member': (ctx) => {
		if (!ctx.user) return deny('unauthenticated');
		if (ctx.user.role !== 'owner') return deny('role-insufficient');
		if (ctx.plan?.tier !== 'family') return deny('plan-tier-insufficient');
		return canWriteDb(ctx);
	},

	'export.activity_history': (ctx) => {
		if (!ctx.user) return deny('unauthenticated');
		if (ctx.user.role === 'child') return deny('role-insufficient');
		if (!ctx.plan || ctx.plan.tier === 'free') return deny('plan-tier-insufficient');
		return ALLOW;
	},

	'access.ops_dashboard': (ctx) => requireOpsGroup(ctx),
	'view.ops_license_dashboard': (ctx) => requireOpsGroup(ctx),

	'purchase.upgrade': (ctx) => {
		if (ctx.mode !== 'aws-prod') return deny('mode-mismatch');
		if (!ctx.user) return deny('unauthenticated');
		if (ctx.user.role !== 'owner') return deny('role-insufficient');
		if (ctx.plan?.tier === 'family') return deny('plan-tier-insufficient');
		return ALLOW;
	},

	'debug.plan_override': (ctx) => {
		if (ctx.mode !== 'local-debug') return deny('dev-only');
		return ALLOW;
	},

	'manage.child_profile': (ctx) => {
		if (!ctx.user) return deny('unauthenticated');
		if (ctx.user.role === 'child') return deny('role-insufficient');
		return canWriteDb(ctx);
	},

	'redeem.license_key': (ctx) => {
		if (ctx.mode !== 'nuc-prod') return deny('mode-mismatch');
		if (!ctx.user) return deny('unauthenticated');
		if (ctx.user.role !== 'owner') return deny('role-insufficient');
		return ALLOW;
	},
};

function requireOpsGroup(ctx: EvaluationContext): PolicyResult {
	if (!ctx.user) return deny('unauthenticated');
	if (!ctx.user.groups.includes('ops')) return deny('ops-only');
	return ALLOW;
}

/**
 * capability の許可判定。純関数、副作用なし。
 *
 * UI / load / action のいずれからも呼べる。`{#if can(ctx, cap).allowed}` の形で
 * UI 制御に使ってもよいし、`ensureCan()` でガードにしてもよい。
 */
export function can(ctx: EvaluationContext, cap: Capability): PolicyResult {
	return evaluators[cap](ctx);
}

/**
 * capability が denied なら 403 を throw する。
 * route / action の冒頭で `ensureCan(ctx, 'invite.family_member')` の形で使う。
 *
 * `error()` は SvelteKit の handler に拾われ、JSON レスポンスが返る。
 * reason は構造化レスポンスに含むが、UI 露出時は i18n キーにマップする想定。
 */
export function ensureCan(ctx: EvaluationContext, cap: Capability): void {
	const result = can(ctx, cap);
	if (!result.allowed) {
		error(403, {
			message: `capability '${cap}' denied`,
			reason: result.reason ?? 'unknown',
		});
	}
}
