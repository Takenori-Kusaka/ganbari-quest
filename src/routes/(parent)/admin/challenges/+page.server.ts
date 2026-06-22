// admin/challenges/+page.server.ts
// チャレンジ閲覧 (#3195、EPIC #3193 child_challenges 一本化)
//
// 親手動作成 / 一括追加 / 兄弟コピー / marketplace challenge-set 取込 / 競争モードは撤去。
// チャレンジはアプリが毎週自動生成する (child-challenge-service.getOrCreateWeeklyChildChallenge)。
// 本 page は「自動生成された子のチャレンジを親が閲覧する」読み取り専用ビュー (削除のみ可)。
// 全プランに開放 (旧 family 限定 gate を撤去)。

import { fail } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	deleteChildChallenge,
	getChallengeGroupsForAdmin,
} from '$lib/server/services/child-challenge-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { getFamilyStreak, getNextMilestone } from '$lib/server/services/family-streak-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);

	const [challengeGroups, children, familyStreakData] = await Promise.all([
		getChallengeGroupsForAdmin(tenantId),
		getAllChildren(tenantId),
		getFamilyStreak(tenantId),
	]);

	const familyStreak = {
		...familyStreakData,
		nextMilestone: getNextMilestone(familyStreakData.currentStreak),
	};

	// 子供別タブ切替 (?childId=N、未指定なら 'all')
	const childIdParam = url.searchParams.get('childId');
	const selectedChildId =
		childIdParam && childIdParam !== 'all' ? Number(childIdParam) : ('all' as const);

	return {
		challengeGroups,
		children,
		familyStreak,
		selectedChildId,
	};
};

export const actions: Actions = {
	// 1 instance 削除 (親が自動生成チャレンジを除去できる)
	delete: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!id) return fail(400, { error: 'IDが不正です' });
		await deleteChildChallenge(id, tenantId);
		return { deleted: true };
	},
};
