// src/lib/domain/errors.ts
// #744: プラン制限エラーの共有型定義
//
// server (`apiError` / `fail(403, ...)`) とクライアント（フォームアクション結果ハンドラ等）で
// 同じ型を参照できるよう、ドメイン層に型を置く。実装の移行は別チケットで段階的に行う。

// PlanTier はドメインの概念だが、現状は plan-limit-service.ts に定義されているため
// type-only import で利用する（実行時に server コードを読み込まない）。
import type { PlanTier } from '$lib/server/services/plan-limit-service';

/**
 * プラン制限で API / フォームアクションが拒否された際のエラー body。
 *
 * HTTP ステータス: **403 Forbidden**
 *
 * ## レスポンス例
 *
 * ```json
 * {
 *   "error": {
 *     "code": "PLAN_LIMIT_EXCEEDED",
 *     "message": "AI 活動提案はスタンダードプラン以上でご利用いただけます",
 *     "currentTier": "free",
 *     "requiredTier": "standard",
 *     "upgradeUrl": "/admin/license"
 *   }
 * }
 * ```
 *
 * ## 使い方（server）
 *
 * - API エンドポイント: `src/lib/server/errors.ts` の `planLimitError()` を使う
 * - フォームアクション: `fail(403, { error: createPlanLimitError(...) })` を返す
 *
 * ## 使い方（client）
 *
 * - `result.data?.error?.code === 'PLAN_LIMIT_EXCEEDED'` で判定
 * - `requiredTier` を使ってアップグレード先のプラン表記を動的に切り替え
 *
 * @see docs/design/07-API設計書.md §4.2 プラン制限エラー
 * @see ADR-0024 plan-tier-resolution-pattern
 */
export interface PlanLimitError {
	/** 常に 'PLAN_LIMIT_EXCEEDED' */
	code: 'PLAN_LIMIT_EXCEEDED';
	/** 人間可読なエラーメッセージ（日本語） */
	message: string;
	/** リクエスト時点でのテナントのプラン。トライアルの場合はトライアルティアが入る */
	currentTier: PlanTier;
	/** この操作を許可する最小プラン */
	requiredTier: Exclude<PlanTier, 'free'>;
	/** アップグレード導線 URL。常に '/admin/license' */
	upgradeUrl: '/admin/license';
}

/** レスポンス body のエラー部分（`{ error: ... }` の値） */
export type PlanLimitErrorBody = PlanLimitError;

/**
 * PlanLimitError を組み立てるヘルパー。
 *
 * @example
 * ```ts
 * return json(
 *   { error: createPlanLimitError('free', 'standard', 'AI 活動提案はスタンダードプラン以上でご利用いただけます') },
 *   { status: 403 },
 * );
 * ```
 */
export function createPlanLimitError(
	currentTier: PlanTier,
	requiredTier: Exclude<PlanTier, 'free'>,
	message: string,
): PlanLimitError {
	return {
		code: 'PLAN_LIMIT_EXCEEDED',
		message,
		currentTier,
		requiredTier,
		upgradeUrl: '/admin/license',
	};
}

/**
 * レスポンスが PlanLimitError 形式かを型ガードで判定する。
 *
 * クライアント側で `result.data?.error` を受け取った際に使う。
 */
export function isPlanLimitError(value: unknown): value is PlanLimitError {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		v.code === 'PLAN_LIMIT_EXCEEDED' &&
		typeof v.message === 'string' &&
		(v.currentTier === 'free' || v.currentTier === 'standard' || v.currentTier === 'family') &&
		(v.requiredTier === 'standard' || v.requiredTier === 'family') &&
		v.upgradeUrl === '/admin/license'
	);
}

/**
 * `form.error` / `result.data?.error` の値を表示用の文字列に正規化する (#787)。
 *
 * サーバ側のフォームアクションが返すエラーは、
 * - 従来: `{ error: string }` （バリデーションエラー等）
 * - 新規: `{ error: PlanLimitError }` （プラン制限エラー）
 *
 * の 2 形態が混在するため、Svelte 側で `getErrorMessage(form?.error)` を使って
 * 一貫した文字列を得る。値が空/未定義なら空文字を返す。
 */
export function getErrorMessage(value: unknown): string {
	if (value == null) return '';
	if (typeof value === 'string') return value;
	if (isPlanLimitError(value)) return value.message;
	// 想定外のオブジェクトでも `.message` があれば取り出す（Error 互換）
	if (typeof value === 'object' && 'message' in value) {
		const msg = (value as { message: unknown }).message;
		if (typeof msg === 'string') return msg;
	}
	return '';
}
