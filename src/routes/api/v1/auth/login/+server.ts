import { json } from '@sveltejs/kit';
import { OYAKAGI_LABELS } from '$lib/domain/labels';
import {
	loginSchema,
	SESSION_COOKIE_NAME,
	SESSION_MAX_AGE_SECONDS,
} from '$lib/domain/validation/auth';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { apiError, validationError } from '$lib/server/errors';
import { login } from '$lib/server/services/auth-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();
	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? OYAKAGI_LABELS.formatError);
	}

	const result = await login(parsed.data.pin, tenantId);

	if ('error' in result) {
		if (result.error === 'LOCKED_OUT') {
			return apiError('LOCKED_OUT', OYAKAGI_LABELS.lockedError);
		}
		return apiError('INVALID_PIN', OYAKAGI_LABELS.invalidError);
	}

	cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: COOKIE_SECURE,
		maxAge: SESSION_MAX_AGE_SECONDS,
	});

	return json({ message: 'ログインしました' });
};
