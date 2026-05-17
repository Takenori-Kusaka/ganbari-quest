// #2140 MP-5: setup wizard β 採用 (3 step 分割) — step 2「ごほうび一括追加」
// `setup/packs/+page.server.ts` を template として横展開（ADR-0014 整合）。
//
// 既存ロジックとの差分:
// - reward-set は子供毎に紐付くため childId 引数を受け取る（複数子供時は最初の 1 名を auto-select、
//   親が UI で切替可能）
// - skip 動線は packs と異なり「auto-import なし」(reward は趣味性が強く、親に選んでほしいため)
// - 次の遷移先は /setup/rules

import { redirect } from '@sveltejs/kit';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import type { RewardSetPayload } from '$lib/domain/marketplace-item';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	importRewardSet,
	previewRewardSetImport,
} from '$lib/server/services/reward-set-import-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);

	// Guard: No children -> go back to step 1
	const children = await getAllChildren(tenantId);
	if (children.length === 0) {
		redirect(302, '/setup/children');
	}

	// Compute child age range for recommendations
	const ages = children.map((c) => c.age);
	const minAge = Math.min(...ages);
	const maxAge = Math.max(...ages);

	const rewardSetMetas = getMarketplaceIndex().filter((m) => m.type === 'reward-set');

	const rewardSetsWithPreview = rewardSetMetas.map((p) => {
		const full = getMarketplaceItem('reward-set', p.itemId);
		const payload = full?.payload as RewardSetPayload | undefined;
		const rewards = payload
			? payload.rewards.map((r) => ({
					title: r.title,
					icon: r.icon,
					points: r.points,
				}))
			: [];
		return {
			itemId: p.itemId,
			name: p.name,
			description: p.description,
			icon: p.icon,
			targetAgeMin: p.targetAgeMin,
			targetAgeMax: p.targetAgeMax,
			tags: p.tags,
			rewardCount: p.itemCount,
			rewards,
		};
	});

	return {
		rewardSets: rewardSetsWithPreview,
		children: children.map((c) => ({ id: c.id, nickname: c.nickname, age: c.age })),
		childAgeMin: minAge,
		childAgeMax: maxAge,
	};
};

export const actions: Actions = {
	importRewards: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const itemIds = formData.getAll('itemIds').map((v) => v.toString());
		const childIdRaw = formData.get('childId')?.toString();
		const childId = childIdRaw ? Number(childIdRaw) : NaN;

		if (itemIds.length === 0 || !childId || Number.isNaN(childId)) {
			// Nothing to import — fall through to next step
			redirect(302, '/setup/rules?rewardsImported=0&rewardsSkipped=0');
		}

		let totalImported = 0;
		let totalSkipped = 0;
		const allErrors: string[] = [];

		for (const itemId of itemIds) {
			try {
				const item = getMarketplaceItem('reward-set', itemId);
				if (!item) {
					allErrors.push(`セット「${itemId}」が見つかりません`);
					continue;
				}
				const rewards = (item.payload as RewardSetPayload).rewards;
				const preview = await previewRewardSetImport(rewards, itemId, childId, tenantId);

				if (preview.newRewards > 0) {
					const result = await importRewardSet(rewards, tenantId, {
						presetId: itemId,
						childId,
					});
					totalImported += result.imported;
					totalSkipped += result.skipped;
					allErrors.push(...result.errors);
				} else {
					totalSkipped += preview.total;
				}
			} catch {
				allErrors.push(`セット「${itemId}」の読み込みに失敗しました`);
			}
		}

		trackSetupFunnel('setup_rewards_selected', tenantId, {
			itemCount: itemIds.length,
			childId,
			imported: totalImported,
		});
		redirect(302, `/setup/rules?rewardsImported=${totalImported}&rewardsSkipped=${totalSkipped}`);
	},

	skip: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		trackSetupFunnel('setup_rewards_skipped', tenantId, {});
		// #2140 MP-5: reward は趣味性が強いため auto-import なし。次の step に進むだけ
		redirect(302, '/setup/rules?rewardsImported=0&rewardsSkipped=0');
	},
};
