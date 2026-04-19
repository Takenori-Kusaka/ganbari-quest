// src/lib/server/request-context.ts
// リクエスト単位の memoize ストア (#788)
//
// 背景: `resolveFullPlanTier` は admin 配下の全ページで呼ばれるが、内部で
// `getTrialStatus` → `trial_history` SELECT を実行する。layout + 各 page.server +
// 個別サービスが独立に呼ぶと、同一リクエストで同じテナントに対し DB を複数回叩き、
// 本番 DynamoDB ではコスト・レイテンシの温床になる。
//
// 対応: AsyncLocalStorage でリクエストごとにキャッシュを持ち、
// `resolveFullPlanTier` / `getTrialStatus` が同じ引数で 2 回目以降呼ばれた時は
// DB をスキップする。hooks.server.ts の handle をこのストアでラップする。
//
// 透過的な最適化のため、55 箇所以上ある呼び出し元を一切変更しない。
// 無効化は `invalidateRequestCaches(tenantId)` — トライアル開始/終了など
// 同一リクエスト内で状態が変わる操作の直後に呼ぶ。

import { AsyncLocalStorage } from 'node:async_hooks';
import type { EvaluationContext } from '$lib/runtime/evaluation-context';
import type { PlanTier } from '$lib/server/services/plan-limit-service';
import type { TrialStatus } from '$lib/server/services/trial-service';

interface RequestContext {
	/** key: `${tenantId}::${licenseStatus}::${planId ?? ''}` */
	planTierCache: Map<string, PlanTier>;
	/** key: tenantId */
	trialStatusCache: Map<string, TrialStatus>;
	/**
	 * ADR-0040 P3 (#1215): hooks.server.ts で認証解決完了後に 1 回だけ構築される
	 * 実行文脈。Policy Gate (P4) が `can()` で参照する。
	 * hooks が注入する前は undefined。
	 */
	evaluationContext?: EvaluationContext;
}

const store = new AsyncLocalStorage<RequestContext>();

/**
 * リクエスト境界でコンテキストを張る。hooks.server.ts の handle 全体を包む想定。
 * 外側のリクエストコンテキストが既に存在する場合（ネストしたテストなど）は
 * 新しいコンテキストを上書きせず既存を再利用する。
 */
export function runWithRequestContext<T>(fn: () => Promise<T>): Promise<T> {
	if (store.getStore()) {
		// 既にコンテキスト内なら二重に張らない
		return fn();
	}
	return store.run<Promise<T>>(
		{
			planTierCache: new Map(),
			trialStatusCache: new Map(),
		},
		fn,
	);
}

/**
 * 現在のリクエストコンテキストを取得。コンテキスト外（バックグラウンドジョブ等）なら undefined。
 * 呼び出し側は `undefined` の場合にキャッシュを使わず素通しでよい。
 */
export function getRequestContext(): RequestContext | undefined {
	return store.getStore();
}

/**
 * 指定テナントに紐づくキャッシュを破棄する。
 * トライアル開始/終了・プラン変更など、リクエスト内で状態が変わる操作後に呼ぶこと。
 */
export function invalidateRequestCaches(tenantId: string): void {
	const ctx = store.getStore();
	if (!ctx) return;
	ctx.trialStatusCache.delete(tenantId);
	// planTier は key に tenantId prefix を含むため前方一致で削除
	const prefix = `${tenantId}::`;
	for (const key of ctx.planTierCache.keys()) {
		if (key.startsWith(prefix)) ctx.planTierCache.delete(key);
	}
}

/** planTier キャッシュのキーを構築 */
export function buildPlanTierCacheKey(
	tenantId: string,
	licenseStatus: string,
	planId: string | undefined,
): string {
	return `${tenantId}::${licenseStatus}::${planId ?? ''}`;
}
