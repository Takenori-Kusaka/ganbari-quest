import { json } from '@sveltejs/kit';
import { PLAN_GATE_LABELS, SETTINGS_LABELS } from '$lib/domain/labels';
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
	| 'EXPORT_NOT_READY'
	| 'EXPORT_FAILED'
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
	// #4717: クラウド共有データが生成待ち (pending/building)。時間をおけば解決するので retry を促す。
	EXPORT_NOT_READY: {
		status: 409,
		userMessage: SETTINGS_LABELS.cloudImportNotReady,
		severity: 'info',
		action: 'retry',
	},
	// #4717: クラウド共有データの生成が失敗している。受け取る側の操作では解決しない。
	EXPORT_FAILED: {
		status: 409,
		userMessage: SETTINGS_LABELS.cloudImportBuildFailed,
		severity: 'error',
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
