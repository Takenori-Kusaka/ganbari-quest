import {
	SESSION_COOKIE_NAME,
	SESSION_MAX_AGE_SECONDS,
	loginSchema,
} from '$lib/domain/validation/auth';
import { apiError, validationError } from '$lib/server/errors';
import { login } from '$lib/server/services/auth-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json();
	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'PINが不正です');
	}

	const result = login(parsed.data.pin);

	if ('error' in result) {
		if (result.error === 'LOCKED_OUT') {
			return apiError('LOCKED_OUT', 'アカウントがロックされています');
		}
		if (result.error === 'PIN_NOT_SET') {
			return apiError('INTERNAL_ERROR', 'PINが設定されていません');
		}
		return apiError('INVALID_PIN', 'PINがちがいます');
	}

	cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: false,
		maxAge: SESSION_MAX_AGE_SECONDS,
	});

	return json({ message: 'ログインしました' });
};
