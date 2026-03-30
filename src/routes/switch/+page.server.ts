import { dev } from '$app/environment';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAuthMode } from '$lib/server/auth/factory';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { getAllChildren, getChildById } from '$lib/server/services/child-service';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = locals.context?.tenantId;
	if (!tenantId) {
		redirect(302, '/auth/login');
	}
	const reason = url.searchParams.get('reason');

	let children = await getAllChildren(tenantId);

	// child ロールで childId が紐づけ済みの場合、自分のプロフィールのみ表示 (#0156)
	if (locals.context?.role === 'child' && locals.context.childId) {
		children = children.filter((c) => c.id === locals.context?.childId);
	}

	const authMode = getAuthMode();
	// local モードは認証不要なので直接 /admin、cognito モードは /auth/login
	const adminLink = authMode === 'cognito' ? '/auth/login' : '/admin';
	// child ロールには管理画面リンクを非表示（local モードでは常に表示）
	const showAdminLink = authMode === 'local' || locals.context?.role !== 'child';
	return { children, adminLink, showAdminLink, reason };
};

export const actions: Actions = {
	select: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = formData.get('childId');

		if (!childId) {
			return { error: 'こどもをえらんでね' };
		}

		// child ロールは紐づけ済みの自分のプロフィールのみ選択可 (#0156)
		if (locals.context?.role === 'child' && locals.context.childId) {
			if (Number(childId) !== locals.context.childId) {
				return { error: 'このプロフィールは選べません' };
			}
		}

		cookies.set('selectedChildId', String(childId), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: COOKIE_SECURE,
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
