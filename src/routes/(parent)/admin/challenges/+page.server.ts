// admin/challenges/+page.server.ts
// チャレンジ閲覧 (#3195、EPIC #3193 child_challenges 一本化)
//
// 親手動作成 / 一括追加 / 兄弟コピー / marketplace challenge-set 取込 / 競争モードは撤去。
// チャレンジはアプリが毎週自動生成する (child-challenge-service.getOrCreateWeeklyChildChallenge)。
// 本 page は「自動生成された子のチャレンジを親が閲覧する」読み取り専用ビュー (削除のみ可)。
// 全プランに開放 (旧 family 限定 gate を撤去)。

import { fail } from '@sveltejs/kit';
import { formIdString } from '$lib/domain/form-value';
import { asChildId } from '$lib/domain/ids';
// #4512: form action のエラー文言は labels SSOT 経由 (docs/DESIGN.md §6 / ADR-0045)
import { ADMIN_FORM_ERROR_LABELS } from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import { warnOrphanChildReferences } from '$lib/server/orphan-child-reference';
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

	// #4556: 表示側 (`UNRESOLVED_ENTITY_LABELS.child`) は解決できない childId を「不明なお子さま」に
	// 潰すため、孤立レコードが増えても画面からは分からない。件数を後から数えられるようにする。
	warnOrphanChildReferences({
		tenantId,
		referencedChildIds: challengeGroups.flatMap((g) => g.instances.map((i) => i.childId)),
		knownChildIds: children.map((c) => c.id),
		source: 'admin/challenges:load',
	});

	const familyStreak = {
		...familyStreakData,
		nextMilestone: getNextMilestone(familyStreakData.currentStreak),
	};

	// 子供別タブ切替 (?childId=N、未指定なら 'all')
	const childIdParam = url.searchParams.get('childId');
	const selectedChildId =
		childIdParam && childIdParam !== 'all' ? asChildId(childIdParam) : ('all' as const);

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
		const id = formIdString(fd.get('id'));
		if (!id) return fail(400, { error: ADMIN_FORM_ERROR_LABELS.idInvalid });
		await deleteChildChallenge(id, tenantId);
		return { deleted: true };
	},
};
