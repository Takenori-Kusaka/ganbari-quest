import { SESSION_COOKIE_NAME } from '$lib/domain/validation/auth';
import { logout } from '$lib/server/services/auth-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	logout();
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	return json({ message: 'ログアウトしました' });
};
