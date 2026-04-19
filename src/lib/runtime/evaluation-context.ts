/**
 * EvaluationContext (ADR-0040 Phase 3 / #1215)
 *
 * リクエスト単位の "文脈オブジェクト"。OpenFeature の evaluation context 概念を参考に、
 * mode × user × plan × licenseKey × now を 1 つに束ねて hooks.server.ts で 1 回だけ
 * 構築し、#788 の AsyncLocalStorage に注入する。
 *
 * 目的:
 * - P4 Policy Gate の `can(ctx, capability)` が 4 因子を個別取得する必要を無くす
 * - テストで mode + plan + user を固定するときに個別 mock が不要になる
 * - `+page.server.ts` の load や services が `getEvaluationContext()` で統一参照できる
 *
 * 設計上の制約:
 * - `buildEvaluationContext` は **純関数** (I/O なし)。I/O は hooks.server.ts 側が担う
 * - server→client に **全量露出しない** (ADR-0009 教訓)。load は必要な投影だけ client に渡す
 * - 既存の `event.locals.*` / `resolvePlanTier` / `getTrialStatus` は変更しない (共存期間)
 */

import { getRequestContext } from '$lib/server/request-context';
import type { RuntimeMode } from './runtime-mode';

/** 認証されたユーザーの識別情報（投影） */
export interface EvaluationUser {
	/** Identity 固有の ID (local: 'local', cognito: userId) */
	id: string;
	/** テナント内ロール */
	role: 'owner' | 'parent' | 'child';
	/** Cognito groups 等の外部グループ所属 (ops 認可などに利用) */
	groups: readonly string[];
}

/** プラン解決結果（ADR-0024 の resolvePlanTier / trial-service 結果の投影） */
export interface EvaluationPlan {
	/** プランティア（free / standard / family） */
	tier: 'free' | 'standard' | 'family';
	/** サブスクリプション状態 */
	status: 'none' | 'active' | 'grace_period' | 'canceled';
	/** トライアル状態 */
	trialState: 'none' | 'active' | 'expired';
}

/** ライセンスキー検証結果（ADR-0026、nuc-prod モードのみ） */
export interface EvaluationLicenseKey {
	valid: boolean;
	expiresAt: Date | null;
}

/**
 * リクエスト単位の文脈オブジェクト。
 *
 * hooks.server.ts が認証解決完了後に 1 回だけ構築し、P4 Policy Gate の `can()` が参照する。
 */
export interface EvaluationContext {
	/** 実行モード。env + URL + cookie から P2 の resolveRuntimeMode が決定 */
	mode: RuntimeMode;
	/** 認証結果。demo / build / 未ログインでは null */
	user: EvaluationUser | null;
	/** ライセンスプラン。未認証 / demo / プラン未確定のうちは null */
	plan: EvaluationPlan | null;
	/** NUC モードのみ ADR-0026 のライセンスキー検証結果が入る。それ以外は null */
	licenseKey: EvaluationLicenseKey | null;
	/** 現在時刻。テストで固定化するためのファネル */
	now: Date;
}

/** buildEvaluationContext の入力。純関数として扱えるよう、全て明示的に渡す */
export interface BuildEvaluationContextInput {
	mode: RuntimeMode;
	user?: EvaluationUser | null;
	plan?: EvaluationPlan | null;
	licenseKey?: EvaluationLicenseKey | null;
	/** 省略時は `new Date()`。テスト時は固定化したい日時を渡す */
	now?: Date;
}

/**
 * EvaluationContext を純粋に構築する。I/O は一切行わない。
 *
 * hooks.server.ts / テストの両方から同じ関数で組み立てることで、
 * 実環境と単体テストの context が乖離しないことを保証する。
 */
export function buildEvaluationContext(input: BuildEvaluationContextInput): EvaluationContext {
	return {
		mode: input.mode,
		user: input.user ?? null,
		plan: input.plan ?? null,
		licenseKey: input.licenseKey ?? null,
		now: input.now ?? new Date(),
	};
}

/**
 * 現在のリクエストの EvaluationContext を取得する。
 *
 * AsyncLocalStorage 外（バックグラウンドジョブ、build script、未注入のテスト等）では
 * `undefined` を返す。呼び出し側は fallback ロジックを用意するか、
 * hooks での注入が保証される経路でのみ使うこと。
 */
export function getEvaluationContext(): EvaluationContext | undefined {
	return getRequestContext()?.evaluationContext;
}

/**
 * 現在のリクエストに EvaluationContext を注入する。
 *
 * hooks.server.ts から認証解決完了後に 1 回だけ呼ぶ想定。
 * AsyncLocalStorage 外（未ラップのコンテキスト）から呼ばれた場合は no-op（sink）。
 * ネスト呼び出しは既存の `runWithRequestContext` の「既存を再利用」仕様に従う。
 */
export function setEvaluationContext(ctx: EvaluationContext): void {
	const store = getRequestContext();
	if (!store) return;
	store.evaluationContext = ctx;
}
