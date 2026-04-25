// /admin/rewards — 特別報酬の付与（#336, #501, #581 プリセット追加, #728 プランゲート, #787 PlanLimitError 統一, #1337 申請タブ追加）

import { fail } from '@sveltejs/kit';
import { PRESET_REWARD_GROUPS } from '$lib/data/preset-rewards';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	isPaidTier,
	type PlanTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import {
	approveRedemption,
	getRedemptionRequestsForParent,
	rejectRedemption,
} from '$lib/server/services/reward-redemption-service';
import {
	getChildSpecialRewards,
	getRewardTemplates,
	grantSpecialReward,
	type RewardTemplate,
	saveRewardTemplates,
} from '$lib/server/services/special-reward-service';
import type { Actions, PageServerLoad } from './$types';

const UPGRADE_MESSAGE = '特別なごほうび設定はスタンダードプラン以上でご利用いただけます';

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

	// 申請一覧を取得（pending + 最近30件の承認/却下履歴）
	const [pendingRequests, historyRequests] = await Promise.all([
		getRedemptionRequestsForParent(tenantId, { status: 'pending_parent_approval' }),
		getRedemptionRequestsForParent(tenantId, { limit: 30 }).then((reqs) =>
			reqs.filter((r) => r.status === 'approved' || r.status === 'rejected'),
		),
	]);

	return {
		children: childrenWithRewards,
		templates,
		presetGroups: PRESET_REWARD_GROUPS,
		isPremium,
		planTier: tier,
		pendingRequests,
		historyRequests,
	};
};

/** 現在のプラン tier を解決して返すヘルパー (#787) */
async function resolveTier(locals: App.Locals, tenantId: string): Promise<PlanTier> {
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	return resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
}

export const actions: Actions = {
	grant: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// #728: プランゲート — 無料プランはカスタム報酬付与不可
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

		const result = await grantSpecialReward({ childId, title, points, icon, category }, tenantId);
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

	approveRedemption: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const requestId = Number(formData.get('requestId'));
		if (!requestId) return fail(400, { redemptionError: '申請IDが不正です' });

		// parentId は approveRedemption の resolved_by_parent_id に記録するだけの追跡用
		// AuthContext に userId が無いため 0 をフォールバックとして使用
		const parentId = 0;

		const result = await approveRedemption(requestId, parentId, tenantId);
		if ('error' in result) {
			const msgs: Record<string, string> = {
				INVALID_STATUS: '既に処理済みの申請です',
				INSUFFICIENT_POINTS: 'ポイントが不足しています',
				REQUEST_NOT_FOUND: '申請が見つかりません',
			};
			return fail(400, { redemptionError: msgs[result.error] ?? 'エラーが発生しました' });
		}

		return { redemptionApproved: true };
	},

	rejectRedemption: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const requestId = Number(formData.get('requestId'));
		const parentNote = String(formData.get('parentNote') ?? '').trim() || null;
		if (!requestId) return fail(400, { redemptionError: '申請IDが不正です' });

		const result = await rejectRedemption(requestId, parentNote, tenantId);
		if ('error' in result) {
			const msgs: Record<string, string> = {
				INVALID_STATUS: '既に処理済みの申請です',
				REQUEST_NOT_FOUND: '申請が見つかりません',
			};
			return fail(400, { redemptionError: msgs[result.error] ?? 'エラーが発生しました' });
		}

		return { redemptionRejected: true };
	},
};
