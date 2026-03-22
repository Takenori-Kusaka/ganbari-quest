import { SESSION_COOKIE_NAME } from '$lib/domain/validation/auth';
import { logout } from '$lib/server/services/auth-service';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	await logout();
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	redirect(302, '/');
};
