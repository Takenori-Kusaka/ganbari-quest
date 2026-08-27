import { json } from '@sveltejs/kit';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
// #2057: 「管理画面」 → 「ご家族の見守り画面」 rename atom 参照
import { ADMIN_VIEW_TERMS } from '$lib/domain/terms';
import { logger } from '$lib/server/logger';

export type ErrorCode =
	| 'VALIDATION_ERROR'
	| 'CANCEL_EXPIRED'
	| 'ALREADY_RECORDED'
	| 'DAILY_LIMIT_REACHED'
	| 'ALREADY_CLAIMED'
	| 'INSUFFICIENT_POINTS'
	| 'INVALID_PIN'
	| 'UNAUTHORIZED'
	| 'LOCKED_OUT'
	| 'NOT_FOUND'
	| 'PLAN_LIMIT_EXCEEDED'
	| 'INTERNAL_ERROR';

export type ErrorSeverity = 'info' | 'warning' | 'error';
export type ErrorAction = 'retry' | 'fix_input' | 'contact_admin' | 'none';

interface ErrorDefinition {
	status: number;
	userMessage: string;
	severity: ErrorSeverity;
	action: ErrorAction;
}

const ERROR_DEFINITIONS: Record<ErrorCode, ErrorDefinition> = {
	VALIDATION_ERROR: {
		status: 400,
		userMessage: '入力内容に問題があります。内容を確認してもう一度お試しください。',
		severity: 'warning',
		action: 'fix_input',
	},
	CANCEL_EXPIRED: {
		status: 400,
		userMessage: 'キャンセル期限を過ぎています。',
		severity: 'info',
		action: 'none',
	},
	ALREADY_RECORDED: {
		status: 409,
		userMessage: 'この活動は既に記録済みです。',
		severity: 'info',
		action: 'none',
	},
	DAILY_LIMIT_REACHED: {
		status: 409,
		userMessage: 'きょうはこれ以上きろくできません。',
		severity: 'info',
		action: 'none',
	},
	ALREADY_CLAIMED: {
		status: 409,
		userMessage: 'このボーナスは既に受け取り済みです。',
		severity: 'info',
		action: 'none',
	},
	INSUFFICIENT_POINTS: {
		status: 400,
		userMessage: 'ポイントが足りません。もう少し活動を記録してから再度お試しください。',
		severity: 'warning',
		action: 'none',
	},
	INVALID_PIN: {
		status: 401,
		userMessage: 'おやカギコードが正しくありません。もう一度入力してください。',
		severity: 'warning',
		action: 'fix_input',
	},
	UNAUTHORIZED: {
		status: 401,
		userMessage: `ログインが必要です。${ADMIN_VIEW_TERMS.canonical}からログインしてください。`,
		severity: 'warning',
		action: 'fix_input',
	},
	LOCKED_OUT: {
		status: 429,
		userMessage: '連続で間違えたため、しばらくログインできません。時間をおいてお試しください。',
		severity: 'error',
		action: 'retry',
	},
	NOT_FOUND: {
		status: 404,
		userMessage: 'お探しのデータが見つかりませんでした。',
		severity: 'warning',
		action: 'none',
	},
	PLAN_LIMIT_EXCEEDED: {
		status: 403,
		userMessage: PLAN_GATE_LABELS.standardOrAboveGenericWithUpgrade,
		severity: 'info',
		action: 'none',
	},
	INTERNAL_ERROR: {
		status: 500,
		userMessage: 'システムに問題が発生しました。しばらくしてからお試しください。',
		severity: 'error',
		action: 'retry',
	},
};

export function apiError(code: ErrorCode, message: string, context?: Record<string, unknown>) {
	const def = ERROR_DEFINITIONS[code];
	if (def.status >= 500) {
		logger.error(`[API] ${code}: ${message}`, { context });
	} else if (def.status >= 400) {
		logger.warn(`[API] ${code}: ${message}`, { context });
	}
	return json(
		{
			error: {
				code,
				message,
				userMessage: def.userMessage,
				severity: def.severity,
				action: def.action,
			},
		},
		{ status: def.status },
	);
}

/**
 * プラン制限による 403 を **要求 tier 込み**で返す (#4710)。
 *
 * `apiError('PLAN_LIMIT_EXCEEDED', …)` は userMessage を `ERROR_DEFINITIONS` の固定文
 * (スタンダード以上の案内) から取るため、**プレミアム限定機能をスタンダード契約者が叩いても
 * 「スタンダード以上でご利用いただけます」** と返していた。既にスタンダードな顧客は
 * 次の行動が取れない (実測: AI 提案 `POST /api/v1/activities/suggest`)。
 *
 * 呼び出し側は「その機能が何 tier を要求するか」を必ず知っている (gate 判定をしている当人)
 * ので、それを引数で受け取り userMessage を出し分ける。`PLAN_LIMIT_EXCEEDED` を
 * `apiError` で直接返す経路は `tests/unit/architecture/plan-limit-error-required-tier.test.ts`
 * が禁止する (同じ穴を別 endpoint で再生産させない)。
 *
 * @param requiredTier その機能が要求する最低 tier
 * @param message 開発者向け (ログ / `error.message`)。顧客には出さない
 */
export function planLimitError(
	requiredTier: 'standard' | 'family',
	message: string,
	context?: Record<string, unknown>,
) {
	const userMessage =
		requiredTier === 'family'
			? PLAN_GATE_LABELS.familyLimitedGenericWithUpgrade
			: PLAN_GATE_LABELS.standardOrAboveGenericWithUpgrade;
	logger.warn(`[API] PLAN_LIMIT_EXCEEDED: ${message}`, { context: { ...context, requiredTier } });
	const def = ERROR_DEFINITIONS.PLAN_LIMIT_EXCEEDED;
	return json(
		{
			error: {
				code: 'PLAN_LIMIT_EXCEEDED',
				message,
				userMessage,
				severity: def.severity,
				action: def.action,
			},
		},
		{ status: def.status },
	);
}

/**
 * **枠が埋まっている**ことによる 403 を返す (#4710)。
 *
 * {@link planLimitError} は「その tier では機能が使えない」前提で userMessage を要求 tier から
 * 組み立てる (次の行動 = アップグレード)。一方 quota (クラウド保管 3 件等) の上限に達するのは
 * **既に契約している顧客**なので、同じ文言を返すと「スタンダードプラン以上でご利用いただけます」と
 * 契約済みの顧客に言うことになり、次の行動が取れない (#4710 の症状そのもの)。最上位プランの
 * 顧客に至っては上げ先すら無い。
 *
 * したがって userMessage は要求 tier からではなく、**呼び出し側が labels SSOT から渡した
 * 「その場で取れる行動」を言う文言**をそのまま使う。
 *
 * status / code は `planLimitError` と同じ 403 / `PLAN_LIMIT_EXCEEDED` を保つ (枠を決めるのは
 * プランなので client の分岐条件は変わらない)。変えるのは顧客に見える文言だけ。
 *
 * `message` にも同じ文言を入れる: `message` は本来開発者向けだが、admin 設定画面は
 * `resolveApiErrorMessage(status, d.error.message)` で **`message` の方を表示している**ため、
 * ここに開発者向け文字列を入れると顧客側だけ generic 文言に落ちる。内訳 (current / max) は
 * `context` に入れてログにだけ残す。
 *
 * @param userMessage 顧客向け文言。**必ず `PLAN_GATE_LABELS` 等の labels SSOT 経由で渡す** (ADR-0045)
 * @param context ログに残す内訳 (current / max / tenantId 等)。顧客には出さない
 */
export function quotaLimitError(userMessage: string, context?: Record<string, unknown>) {
	logger.warn(`[API] PLAN_LIMIT_EXCEEDED (quota): ${userMessage}`, { context });
	const def = ERROR_DEFINITIONS.PLAN_LIMIT_EXCEEDED;
	return json(
		{
			error: {
				code: 'PLAN_LIMIT_EXCEEDED',
				message: userMessage,
				userMessage,
				severity: def.severity,
				action: def.action,
			},
		},
		{ status: def.status },
	);
}

export function notFound(message = 'みつかりませんでした') {
	return apiError('NOT_FOUND', message);
}

export function validationError(message: string) {
	return apiError('VALIDATION_ERROR', message);
}
