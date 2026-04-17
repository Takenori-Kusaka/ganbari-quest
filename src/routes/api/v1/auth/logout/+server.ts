import { json, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE_NAME } from '$lib/domain/validation/auth';
import { logout } from '$lib/server/services/auth-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	await logout(tenantId);
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	redirect(302, '/');
};
