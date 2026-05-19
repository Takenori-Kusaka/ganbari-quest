// #2298 (EPIC #2294 ④): setup wizard β step 4「家族チャレンジ一括追加」
// `setup/rules/+page.server.ts` を template として横展開（ADR-0014 整合）。
//
// - PRESET_CHALLENGES から 5-7 件の家族向けチャレンジテンプレートを提示
// - 任意 step (skip 可、ADR-0012 anti-engagement 整合)
// - 「おすすめ 3 件を自動追加」or 親が個別選択
// - 選択された preset は sibling-challenge-service.createSiblingChallenge 経由で
//   tenant に紐付け、challengeType=cooperative 固定 (子#2 で競争型は削除済)
// - 次の遷移先は /setup/first-adventure (既存)

import { redirect } from '@sveltejs/kit';
import {
	getAutoAddRecommendedPresets,
	getPresetChallengeById,
	PRESET_CHALLENGES,
	resolvePresetChallengeDates,
} from '$lib/data/preset-challenges';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import { createSiblingChallenge } from '$lib/server/services/sibling-challenge-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);

	// Guard: 子供が 0 名なら step 1 へ戻す（rewards / rules と同じパターン）
	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	// 各 preset を実行時の具体日付に解決
	const now = new Date();
	const presets = PRESET_CHALLENGES.map((p) => {
		const { startDate, endDate } = resolvePresetChallengeDates(p, now);
		return {
			id: p.id,
			title: p.title,
			description: p.description,
			icon: p.icon,
			baseTarget: p.baseTarget,
			rewardPoints: p.rewardPoints,
			categoryId: p.categoryId,
			autoAddRecommended: p.autoAddRecommended,
			startDate,
			endDate,
		};
	});

	return {
		presets,
		childrenCount: children.length,
	};
};

async function addPresetsAsChallenges(
	presetIds: readonly string[],
	tenantId: string,
): Promise<{ added: number; errors: string[] }> {
	let added = 0;
	const errors: string[] = [];
	const now = new Date();

	for (const id of presetIds) {
		const preset = getPresetChallengeById(id);
		if (!preset) {
			errors.push(`プリセット「${id}」が見つかりません`);
			continue;
		}
		try {
			const { startDate, endDate } = resolvePresetChallengeDates(preset, now);
			const targetConfig = JSON.stringify({
				metric: 'count',
				baseTarget: preset.baseTarget,
				...(preset.categoryId ? { categoryId: preset.categoryId } : {}),
			});
			const rewardConfig = JSON.stringify({
				points: preset.rewardPoints,
				message: preset.title,
			});
			await createSiblingChallenge(
				{
					title: preset.title,
					description: preset.description,
					challengeType: 'cooperative',
					periodType: 'custom',
					startDate,
					endDate,
					targetConfig,
					rewardConfig,
				},
				tenantId,
			);
			added++;
		} catch (e) {
			errors.push(
				`「${preset.title}」の追加に失敗: ${e instanceof Error ? e.message : 'unknown error'}`,
			);
		}
	}
	return { added, errors };
}

export const actions: Actions = {
	addChallenges: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const presetIds = formData.getAll('presetIds').map((v) => v.toString());

		if (presetIds.length === 0) {
			redirect(302, '/setup/first-adventure?challengesAdded=0');
		}

		const { added } = await addPresetsAsChallenges(presetIds, tenantId);
		trackSetupFunnel('setup_challenges_selected', tenantId, {
			presetCount: presetIds.length,
			added,
		});
		redirect(302, `/setup/first-adventure?challengesAdded=${added}`);
	},

	autoAdd: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		const recommended = getAutoAddRecommendedPresets().map((p) => p.id);
		const { added } = await addPresetsAsChallenges(recommended, tenantId);
		trackSetupFunnel('setup_challenges_selected', tenantId, {
			presetCount: recommended.length,
			added,
			autoAdd: true,
		});
		redirect(302, `/setup/first-adventure?challengesAdded=${added}`);
	},

	skip: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		trackSetupFunnel('setup_challenges_skipped', tenantId, {});
		redirect(302, '/setup/first-adventure?challengesAdded=0');
	},
};
