// /setup/first-adventure — はじめてのがんばり体験 (#0262 G4)
// セットアップの最終ステップ前に、子供と一緒に最初の活動記録を体験

import { fail, redirect } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { recordActivity } from '$lib/server/services/activity-log-service';
import { getActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);

	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	// redirect 済みなので children[0] は確実に存在
	const firstChild = children[0];
	if (!firstChild) redirect(302, '/setup/children');
	const activities = await getActivities(tenantId);

	// 子供の年齢に合う活動を3〜5件選ぶ
	const childAge = firstChild.age;
	const ageFiltered = activities
		.filter((a) => a.isVisible)
		.filter((a) => {
			if (a.ageMin !== null && childAge < a.ageMin) return false;
			if (a.ageMax !== null && childAge > a.ageMax) return false;
			return true;
		})
		.slice(0, 5);

	// パックインポート結果を透過
	const imported = Number(url.searchParams.get('imported') ?? 0);
	const skipped = Number(url.searchParams.get('skipped') ?? 0);

	return {
		child: firstChild,
		activities: ageFiltered,
		imported,
		skipped,
	};
};

export const actions: Actions = {
	record: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const activityId = Number(formData.get('activityId'));

		if (!childId || !activityId) {
			return fail(400, { error: '活動を選択してください' });
		}

		const result = await recordActivity(childId, activityId, tenantId);

		if ('error' in result) {
			return fail(400, { error: '記録に失敗しました。もう一度お試しください。' });
		}

		trackSetupFunnel('setup_first_adventure_completed', tenantId, {
			activityId,
			activityName: result.activityName,
			points: result.totalPoints,
		});

		return {
			success: true,
			activityName: result.activityName,
			totalPoints: result.totalPoints,
			levelUp: result.levelUp,
			unlockedAchievements: result.unlockedAchievements,
		};
	},

	skip: async ({ locals, url }) => {
		const tenantId = requireTenantId(locals);
		trackSetupFunnel('setup_first_adventure_skipped', tenantId);
		const imported = url.searchParams.get('imported') ?? '0';
		const skipped = url.searchParams.get('skipped') ?? '0';
		redirect(302, `/setup/complete?imported=${imported}&skipped=${skipped}`);
	},
};
