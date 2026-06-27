// src/routes/(child)/[uiMode=uiMode]/shop/+page.server.ts
// ごほうびショップ 子供側 (#1337)

import { fail } from '@sveltejs/kit';
import { deriveShopCategory } from '$lib/domain/shop-category';
import { requireTenantId } from '$lib/server/auth/factory';
import { getBalance } from '$lib/server/db/point-repo';
import { getChildById } from '$lib/server/services/child-service';
import {
	getRedemptionRequestsForChild,
	requestRedemption,
} from '$lib/server/services/reward-redemption-service';
import { getChildSpecialRewards } from '$lib/server/services/special-reward-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const parentData = await parent();
	const { child } = parentData;

	if (!child) {
		return { rewards: [], balance: 0, redemptionRequests: [] };
	}

	const [rewardsData, balance, redemptionRequests] = await Promise.all([
		getChildSpecialRewards(child.id, tenantId),
		getBalance(child.id, tenantId),
		getRedemptionRequestsForChild(child.id, tenantId),
	]);

	// 各ごほうびに最新の申請状態 + shopCategory (#2157) を付与
	const rewardsWithStatus = rewardsData.rewards.map((reward) => {
		// 最新申請（requestedAt降順）
		const latestRequest = redemptionRequests
			.filter((r) => r.rewardId === reward.id)
			.sort((a, b) => b.requestedAt - a.requestedAt)[0];

		return {
			id: reward.id,
			title: reward.title,
			points: reward.points,
			icon: reward.icon,
			description: reward.description,
			// #2157 / #3147 ショップ 3 系統 (実物/お小遣い/特権)。
			// 親が登録時に選んだ shop_category 列を優先し、null (旧行/未指定) のときのみ
			// title/icon から推定 fallback (後方互換)。
			shopCategory:
				reward.shopCategory ??
				deriveShopCategory({
					title: reward.title,
					icon: reward.icon,
					description: reward.description,
				}),
			latestRequestStatus: latestRequest?.status ?? null,
			latestRequestId: latestRequest?.id ?? null,
		};
	});

	return {
		rewards: rewardsWithStatus,
		balance,
	};
};

export const actions: Actions = {
	requestExchange: async ({ request, locals, cookies }) => {
		const tenantId = requireTenantId(locals);
		const childIdStr = cookies.get('selectedChildId');
		if (!childIdStr) return fail(400, { error: 'こどもが選択されていません' });
		const child = await getChildById(Number(childIdStr), tenantId);
		if (!child) return fail(400, { error: 'こどもが選択されていません' });

		const formData = await request.formData();
		const rewardId = Number(formData.get('rewardId'));
		if (!rewardId) return fail(400, { error: '報酬IDが不正です' });

		const result = await requestRedemption(child.id, rewardId, tenantId);

		if ('error' in result) {
			const msgs: Record<string, string> = {
				INSUFFICIENT_POINTS: 'ポイントが足りません',
				ALREADY_PENDING: '既に申請中です',
				REWARD_NOT_FOUND: 'ごほうびが見つかりません',
			};
			return fail(400, { error: msgs[result.error] ?? 'エラーが発生しました' });
		}

		// #3339: 即時交換（家庭設定 reward_auto_approve ON）なら requestRedemption が approved 確定済。
		// 子供側 UI は invalidateAll 後の latestRequestStatus（approved=「こうかん済み」/
		// pending=「うけとりまち」）でフィードバックが切り替わるため、ここでは success のみ返す。
		return { success: true };
	},
};
