import { SESSION_COOKIE_NAME } from '$lib/domain/validation/auth';
import { requireTenantId } from '$lib/server/auth/factory';
import { logout } from '$lib/server/services/auth-service';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, locals }) => {
	const tenantId = requireTenantId(locals);
	await logout(tenantId);
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	redirect(302, '/');
};
