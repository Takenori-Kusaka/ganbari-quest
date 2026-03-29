import { logger } from '$lib/server/logger';
import { json } from '@sveltejs/kit';

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
		userMessage: 'PINが正しくありません。もう一度入力してください。',
		severity: 'warning',
		action: 'fix_input',
	},
	UNAUTHORIZED: {
		status: 401,
		userMessage: 'ログインが必要です。管理画面からログインしてください。',
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
		userMessage: 'この機能はプレミアムプランでご利用いただけます。プランをアップグレードしてください。',
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

export function notFound(message = 'みつかりませんでした') {
	return apiError('NOT_FOUND', message);
}

export function validationError(message: string) {
	return apiError('VALIDATION_ERROR', message);
}

/** エラーコードからユーザー向けメッセージを取得（page.server.ts の fail() で利用） */
export function getUserMessage(code: ErrorCode): string {
	return ERROR_DEFINITIONS[code].userMessage;
}

/** エラーコードから定義全体を取得 */
export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
	return ERROR_DEFINITIONS[code];
}
