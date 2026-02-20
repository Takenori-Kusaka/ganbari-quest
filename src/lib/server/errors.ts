import { error, json } from '@sveltejs/kit';

export type ErrorCode =
	| 'VALIDATION_ERROR'
	| 'CANCEL_EXPIRED'
	| 'ALREADY_RECORDED'
	| 'ALREADY_CLAIMED'
	| 'INSUFFICIENT_POINTS'
	| 'INVALID_PIN'
	| 'UNAUTHORIZED'
	| 'LOCKED_OUT'
	| 'NOT_FOUND'
	| 'INTERNAL_ERROR';

const STATUS_MAP: Record<ErrorCode, number> = {
	VALIDATION_ERROR: 400,
	CANCEL_EXPIRED: 400,
	ALREADY_RECORDED: 409,
	ALREADY_CLAIMED: 409,
	INSUFFICIENT_POINTS: 400,
	INVALID_PIN: 401,
	UNAUTHORIZED: 401,
	LOCKED_OUT: 429,
	NOT_FOUND: 404,
	INTERNAL_ERROR: 500,
};

export function apiError(code: ErrorCode, message: string) {
	const status = STATUS_MAP[code];
	return json({ error: { code, message } }, { status });
}

export function notFound(message = 'みつかりませんでした') {
	return apiError('NOT_FOUND', message);
}

export function validationError(message: string) {
	return apiError('VALIDATION_ERROR', message);
}
