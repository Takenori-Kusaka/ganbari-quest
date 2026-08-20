// src/routes/(child)/[uiMode=uiMode]/shop/+page.server.ts
// ごほうびショップ 子供側 (#1337)

import { fail } from '@sveltejs/kit';
import { formIdString } from '$lib/domain/form-value';
import { asChildId } from '$lib/domain/ids';
import { getChildShopLabels } from '$lib/domain/labels';
import { deriveShopCategory } from '$lib/domain/shop-category';
import { requireValidChildCookieFormat } from '$lib/server/auth/child-cookie-guard';
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
	requestExchange: async ({ request, locals, cookies, params }) => {
		// #4690 F4: 失敗文言も年齢帯で文体が変わる (docs/DESIGN.md §8)。
		const L = getChildShopLabels(params.uiMode);
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childIdStr = requireValidChildCookieFormat(cookies, 'route.shop.requestExchange');
		if (!childIdStr) return fail(400, { error: L.errorChildNotSelected });
		const child = await getChildById(asChildId(childIdStr), tenantId);
		if (!child) return fail(400, { error: L.errorChildNotSelected });

		const formData = await request.formData();
		const rewardId = formIdString(formData.get('rewardId'));
		if (!rewardId) return fail(400, { error: L.errorRewardNotFound });

		// #4407: 個数。未指定 (旧 client / JS 無効) は 1 個として扱い、値域外は service が弾く。
		const rawQuantity = formData.get('quantity');
		const quantity = rawQuantity === null ? 1 : Number(rawQuantity);

		const result = await requestRedemption(child.id, rewardId, tenantId, quantity);

		if ('error' in result) {
			// #4407 AC10: 状態に合わせた文言を返す。即時交換 ON の直後再申請 (RECENTLY_EXCHANGED) に
			// 「既に申請中です」と出すと事実と違ううえ、子供が次に何をすればよいか分からない。
			const msgs: Record<string, string> = {
				INSUFFICIENT_POINTS: L.errorInsufficientPoints,
				ALREADY_PENDING: L.errorAlreadyPending,
				RECENTLY_EXCHANGED: L.errorRecentlyExchanged,
				INVALID_QUANTITY: L.errorInvalidQuantity,
				REWARD_NOT_FOUND: L.errorRewardNotFound,
			};
			return fail(400, { error: msgs[result.error] ?? L.errorGeneric });
		}

		// #3339: 即時交換（家庭設定 reward_auto_approve ON）なら requestRedemption が approved 確定済。
		// #4407 AC9: 「押した結果」を子供が見ている場所に文字で出せるよう、何を何個 交換できたか /
		// 交換後の残高を action の戻り値として返す (演出 = 紙吹雪 / 音 は加飾であって通知ではない)。
		const balance = await getBalance(child.id, tenantId);
		return {
			success: true as const,
			instant: result.status === 'approved',
			quantity: result.quantity,
			balance,
		};
	},
};
