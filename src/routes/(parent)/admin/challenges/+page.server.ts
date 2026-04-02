import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	createSiblingChallenge,
	deleteSiblingChallenge,
	getAllChallengesWithProgress,
} from '$lib/server/services/sibling-challenge-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const [challenges, children] = await Promise.all([
		getAllChallengesWithProgress(tenantId),
		getAllChildren(tenantId),
	]);
	return { challenges, children };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const title = String(fd.get('title') ?? '').trim();
		const description = String(fd.get('description') ?? '').trim() || null;
		const challengeType = String(fd.get('challengeType') ?? 'cooperative');
		const periodType = String(fd.get('periodType') ?? 'weekly');
		const startDate = String(fd.get('startDate') ?? '');
		const endDate = String(fd.get('endDate') ?? '');

		// ターゲット設定
		const metric = String(fd.get('metric') ?? 'count');
		const baseTarget = Number(fd.get('baseTarget') ?? 3);
		const categoryIdStr = String(fd.get('categoryId') ?? '');
		const categoryId = categoryIdStr ? Number(categoryIdStr) : undefined;

		// 報酬設定
		const rewardPoints = Number(fd.get('rewardPoints') ?? 50);
		const rewardMessage = String(fd.get('rewardMessage') ?? '').trim() || undefined;

		if (!title) return fail(400, { error: 'タイトルを入力してください' });
		if (!startDate || !endDate) return fail(400, { error: '開始日・終了日を入力してください' });
		if (startDate > endDate) return fail(400, { error: '終了日は開始日以降にしてください' });
		if (baseTarget < 1) return fail(400, { error: '目標回数は1以上にしてください' });

		const targetConfig = JSON.stringify({
			metric,
			baseTarget,
			...(categoryId ? { categoryId } : {}),
		});
		const rewardConfig = JSON.stringify({
			points: rewardPoints,
			...(rewardMessage ? { message: rewardMessage } : {}),
		});

		try {
			await createSiblingChallenge(
				{
					title,
					description,
					challengeType,
					periodType,
					startDate,
					endDate,
					targetConfig,
					rewardConfig,
				},
				tenantId,
			);
			return { created: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'チャレンジ作成に失敗しました' });
		}
	},

	delete: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!id) return fail(400, { error: 'IDが不正です' });

		await deleteSiblingChallenge(id, tenantId);
		return { deleted: true };
	},
};
