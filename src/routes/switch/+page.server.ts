import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getAuthMode, requireTenantId } from '$lib/server/auth/factory';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { getAllChildren, getChildById } from '$lib/server/services/child-service';
import {
	getOnboardingProgress,
	type OnboardingProgress,
} from '$lib/server/services/onboarding-service';
import { PARENT_SESSION_COOKIE_NAME } from '$lib/server/services/parent-gate-session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = locals.context?.tenantId;
	if (!tenantId) {
		redirect(302, '/auth/login');
	}
	const reason = url.searchParams.get('reason');

	// EPIC #2310 子#2312: PIN gate modal 自動起動の query
	const pinRequired = url.searchParams.get('pinRequired') === '1';
	const rawNext = url.searchParams.get('next') ?? '/admin';
	// open redirect 防止: /admin 以下のみ許可
	const nextPath = rawNext.startsWith('/admin') ? rawNext : '/admin';

	let children = await getAllChildren(tenantId);

	// child ロールで childId が紐づけ済みの場合、自分のプロフィールのみ表示 (#0156)
	if (locals.context?.role === 'child' && locals.context.childId) {
		children = children.filter((c) => c.id === locals.context?.childId);
	}

	const authMode = getAuthMode();
	// local モードは認証不要なので直接 /admin、cognito モードは /auth/login
	const adminLink = authMode === 'cognito' ? '/auth/login' : '/admin';
	// child ロールにはご家族の見守り画面リンクを非表示（local モードでは常に表示）
	const showAdminLink = authMode === 'local' || locals.context?.role !== 'child';

	// #2821: セットアップ再開導線。親が登録 (≥1 child) 後に setup を離脱して /switch に
	// 着地したとき、残りの初期設定 step への再入口が UI 上消えていた問題への対処。
	// 子ロールには出さない (親の見守り設定タスクのため)。onboarding 取得失敗は導線非表示で
	// ページ全体を守る。Anti-engagement (ADR-0012): allCompleted なら banner は描画されない。
	const isParentContext = authMode === 'local' || locals.context?.role !== 'child';
	let onboarding: OnboardingProgress | null = null;
	if (isParentContext) {
		try {
			onboarding = await getOnboardingProgress(tenantId, '/admin');
		} catch {
			onboarding = null;
		}
	}

	return { children, adminLink, showAdminLink, reason, pinRequired, nextPath, onboarding };
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

		// EPIC #2310 子#2314: 子供モード切替時の PIN session 破棄 (構造的核心)
		// 親が /admin で作業 → /switch で別の子供 profile 選択 → cookie 削除しないと
		// 次に子が「ご家族の見守り画面」リンク click した時に再 PIN 要求なしで /admin 即到達 = privacy リスク継続
		cookies.delete(PARENT_SESSION_COOKIE_NAME, { path: '/' });

		const child = await getChildById(Number(childId), tenantId);
		const uiMode = child?.uiMode ?? 'preschool';
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
