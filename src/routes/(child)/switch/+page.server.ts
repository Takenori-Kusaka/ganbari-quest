import { dev } from '$app/environment';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAuthMode } from '$lib/server/auth/factory';
import { getAllChildren, getChildById } from '$lib/server/services/child-service';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	const authMode = getAuthMode();
	// local モードは認証不要なので直接 /admin、cognito モードは /auth/login
	const adminLink = authMode === 'cognito' ? '/auth/login' : '/admin';
	return { children, adminLink };
};

export const actions: Actions = {
	select: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = formData.get('childId');

		if (!childId) {
			return { error: 'こどもをえらんでね' };
		}

		cookies.set('selectedChildId', String(childId), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: false,
			maxAge: 60 * 60 * 24 * 365,
		});

		const child = await getChildById(Number(childId), tenantId);
		const uiMode = child?.uiMode ?? 'kinder';
		redirect(303, `/${uiMode}/home`);
	},

	resetChild: async ({ request, locals }) => {
		const _tenantId = requireTenantId(locals);
		if (!dev) {
			return { error: 'Not available in production' };
		}

		const formData = await request.formData();
		const childId = Number(formData.get('childId'));

		if (!childId) {
			return { error: 'Invalid childId' };
		}

		// Dynamic import to avoid bundling debug code in production
		const { db } = await import('$lib/server/db/client');
		const { activityLogs, pointLedger, loginBonuses, childAchievements } = await import(
			'$lib/server/db/schema'
		);
		const { eq } = await import('drizzle-orm');

		// Clear activity logs
		db.delete(activityLogs).where(eq(activityLogs.childId, childId)).run();
		// Clear point ledger
		db.delete(pointLedger).where(eq(pointLedger.childId, childId)).run();
		// Clear login bonuses
		db.delete(loginBonuses).where(eq(loginBonuses.childId, childId)).run();
		// Clear achievements
		db.delete(childAchievements).where(eq(childAchievements.childId, childId)).run();

		return { reset: true, childId };
	},
};
