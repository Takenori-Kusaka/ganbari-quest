// /admin/rewards — ごほうび管理 (#336, #501, #581 プリセット追加, #728 プランゲート, #787 PlanLimitError 統一, #1337 申請タブ追加, #2136 MP-1 マーケットプレイス一括追加, #2268 CRUD 整備 + 命名訂正 + 検索 + grant→add リネーム + 申請タブ削除)

import { fail } from '@sveltejs/kit';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import { PRESET_REWARD_GROUPS } from '$lib/data/preset-rewards';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import type { RewardSetPayload } from '$lib/domain/marketplace-item';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	isPaidTier,
	type PlanTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import { getRedemptionRequestsForParent } from '$lib/server/services/reward-redemption-service';
import {
	importRewardSet,
	previewRewardSetImport,
} from '$lib/server/services/reward-set-import-service';
import {
	addReward,
	getChildSpecialRewards,
	getRewardTemplates,
	type RewardTemplate,
	saveRewardTemplates,
} from '$lib/server/services/special-reward-service';
import type { Actions, PageServerLoad } from './$types';

// #2268: 「特別なごほうび設定」→「ごほうび管理」に文言更新
const UPGRADE_MESSAGE = PLAN_GATE_LABELS.standardOrAboveFor('ごほうび管理');

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
	const isPremium = isPaidTier(tier);

	const children = await getAllChildren(tenantId);
	const templates = await getRewardTemplates(tenantId);

	const childrenWithRewards = await Promise.all(
		children.map(async (child) => {
			const rewards = await getChildSpecialRewards(child.id, tenantId);
			return {
				...child,
				rewardCount: rewards.rewards.length,
				totalRewardPoints: rewards.totalPoints,
			};
		}),
	);

	// #2268: 申請承認画面は /admin/rewards/requests に分離 (子#3)。
	// 本画面は pending 件数のみ取得し、overflow menu のバッジに使用する。
	const pendingRequests = await getRedemptionRequestsForParent(tenantId, {
		status: 'pending_parent_approval',
	});

	// #2136 MP-1: マーケットプレイス reward-set 一覧（preview 用）
	const rewardSetMetas = getMarketplaceIndex().filter((m) => m.type === 'reward-set');
	const rewardSets = rewardSetMetas.map((m) => ({
		itemId: m.itemId,
		name: m.name,
		description: m.description,
		icon: m.icon,
		targetAgeMin: m.targetAgeMin,
		targetAgeMax: m.targetAgeMax,
		itemCount: m.itemCount,
	}));

	return {
		children: childrenWithRewards,
		templates,
		presetGroups: PRESET_REWARD_GROUPS,
		isPremium,
		planTier: tier,
		pendingRequestsCount: pendingRequests.length,
		rewardSets,
	};
};

/** 現在のプラン tier を解決して返すヘルパー (#787) */
async function resolveTier(locals: App.Locals, tenantId: string): Promise<PlanTier> {
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	return resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
}

export const actions: Actions = {
	// #2268: grant → add リネーム (実態は special_rewards INSERT、子供 shop に並べる商品の追加)
	add: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// #728: プランゲート — 無料プランはカスタム報酬追加不可
		// #787: PlanLimitError 形式に統一
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const title = String(formData.get('title') ?? '').trim();
		const points = Number(formData.get('points') ?? 0);
		const icon = String(formData.get('icon') ?? '🎁');
		const category = String(formData.get('category') ?? 'other');

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!title) return fail(400, { error: 'タイトルを入力してください' });
		if (points <= 0 || points > 10000) return fail(400, { error: 'ポイントは1〜10000の範囲です' });

		const result = await addReward({ childId, title, points, icon, category }, tenantId);
		if ('error' in result) {
			return fail(400, { error: result.error });
		}

		return { granted: true, reward: result };
	},

	addPreset: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// #728: プランゲート — 無料プランはプリセットの取り込みも不可
		// #787: PlanLimitError 形式に統一
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const title = String(formData.get('title') ?? '').trim();
		const points = Number(formData.get('points') ?? 0);
		const icon = String(formData.get('icon') ?? '🎁');
		const category = String(formData.get('category') ?? 'other');

		if (!title || points <= 0) return fail(400, { error: 'プリセットデータが不正です' });

		const existing = await getRewardTemplates(tenantId);
		if (existing.some((t) => t.title === title)) {
			return { presetAdded: true };
		}

		const newTemplate: RewardTemplate = {
			title,
			points,
			icon,
			category: category as RewardTemplate['category'],
		};
		await saveRewardTemplates([...existing, newTemplate], tenantId);

		return { presetAdded: true };
	},

	// #2136 MP-1: マーケットプレイス reward-set 一括追加
	importMarketplaceRewardSet: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// プランゲート: 無料プランは特別ごほうび設定不可（grant と同等）
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const presetId = String(formData.get('presetId') ?? '').trim();
		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!presetId) return fail(400, { error: 'プリセットが指定されていません' });

		const item = getMarketplaceItem('reward-set', presetId);
		if (!item) {
			return fail(404, { error: `プリセット「${presetId}」が見つかりません` });
		}

		const rewards = (item.payload as RewardSetPayload).rewards;
		const preview = await previewRewardSetImport(rewards, presetId, childId, tenantId);

		if (preview.newRewards === 0) {
			return { marketplaceImport: { allDuplicates: true } };
		}

		const result = await importRewardSet(rewards, tenantId, {
			presetId,
			childId,
		});

		return {
			marketplaceImport: {
				imported: result.imported,
				skipped: result.skipped,
				errors: result.errors,
				presetId,
			},
		};
	},
};
