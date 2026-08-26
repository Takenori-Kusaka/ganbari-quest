// src/routes/(child)/[uiMode=uiMode]/shop/+page.server.ts
// ごほうびショップ 子供側 (#1337)

import { fail, redirect } from '@sveltejs/kit';
import { formIdString } from '$lib/domain/form-value';
import { asChildId } from '$lib/domain/ids';
import { CHILD_SHOP_LABELS } from '$lib/domain/labels';
import { deriveShopCategory } from '$lib/domain/shop-category';
// #4685 (ADR-0011): 年齢帯ごとの機能可否は age-tier.ts の 1 箇所で判定する (散在 if を作らない)
import { hasAgeTierCapability } from '$lib/domain/validation/age-tier';
import { requireValidChildCookieFormat } from '$lib/server/auth/child-cookie-guard';
import { requireTenantId } from '$lib/server/auth/factory';
import { getBalance } from '$lib/server/db/point-repo';
import { getChildById } from '$lib/server/services/child-service';
import {
	getRedemptionRequestsForChild,
	isRewardAutoApproveEnabled,
	requestRedemption,
} from '$lib/server/services/reward-redemption-service';
import { getChildSpecialRewards } from '$lib/server/services/special-reward-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals, params }) => {
	const tenantId = requireTenantId(locals);
	const parentData = await parent();
	const { child } = parentData;

	// #4685: 準備モード (baby) はごほうびショップを持たない。history / status と同じく home へ倒す
	// (旧実装は shop だけ素通りし、1 歳児の名前で交換申請が親の承認待ちに並んでいた)。
	if (!hasAgeTierCapability(params.uiMode, 'rewardShop')) {
		redirect(302, `/${params.uiMode}/home`);
	}

	if (!child) {
		// #4684: 早期 return の shape を通常経路と一致させる (旧実装は通常経路が返さない
		// `redemptionRequests` を返し、通常経路にある `autoApprove` を欠いていた)。
		return { rewards: [], balance: 0, autoApprove: false };
	}

	const [rewardsData, balance, redemptionRequests, autoApprove] = await Promise.all([
		getChildSpecialRewards(child.id, tenantId),
		getBalance(child.id, tenantId),
		getRedemptionRequestsForChild(child.id, tenantId),
		// #4684 F1: 確認ダイアログの説明を「このあと実際に起きること」に合わせるために必要。
		isRewardAutoApproveEnabled(tenantId),
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
		autoApprove,
	};
};

export const actions: Actions = {
	requestExchange: async ({ request, locals, cookies }) => {
		const tenantId = requireTenantId(locals);
		// #3581 ②: dsql backend の stale/非 uuid cookie を cookie clear + /switch redirect に正規化。
		const childIdStr = requireValidChildCookieFormat(cookies, 'route.shop.requestExchange');
		if (!childIdStr) return fail(400, { error: CHILD_SHOP_LABELS.errorChildNotSelected });
		const child = await getChildById(asChildId(childIdStr), tenantId);
		if (!child) return fail(400, { error: CHILD_SHOP_LABELS.errorChildNotSelected });
		// #4685: 画面を塞ぐだけでなく **action 側でも** 拒否する (直接 POST を通さない)。
		// 判定は cookie の uiMode ではなく DB 上の子供の uiMode で行う。
		if (!hasAgeTierCapability(child.uiMode ?? '', 'rewardShop')) {
			return fail(403, { error: CHILD_SHOP_LABELS.errorGeneric });
		}

		const formData = await request.formData();
		const rewardId = formIdString(formData.get('rewardId'));
		if (!rewardId) return fail(400, { error: CHILD_SHOP_LABELS.errorRewardNotFound });

		// #4407: 個数。未指定 (旧 client / JS 無効) は 1 個として扱い、値域外は service が弾く。
		const rawQuantity = formData.get('quantity');
		const quantity = rawQuantity === null ? 1 : Number(rawQuantity);

		const result = await requestRedemption(child.id, rewardId, tenantId, quantity);

		if ('error' in result) {
			// #4407 AC10: 状態に合わせた文言を返す。即時交換 ON の直後再申請 (RECENTLY_EXCHANGED) に
			// 「既に申請中です」と出すと事実と違ううえ、子供が次に何をすればよいか分からない。
			const msgs: Record<string, string> = {
				INSUFFICIENT_POINTS: CHILD_SHOP_LABELS.errorInsufficientPoints,
				ALREADY_PENDING: CHILD_SHOP_LABELS.errorAlreadyPending,
				RECENTLY_EXCHANGED: CHILD_SHOP_LABELS.errorRecentlyExchanged,
				INVALID_QUANTITY: CHILD_SHOP_LABELS.errorInvalidQuantity,
				REWARD_NOT_FOUND: CHILD_SHOP_LABELS.errorRewardNotFound,
			};
			return fail(400, { error: msgs[result.error] ?? CHILD_SHOP_LABELS.errorGeneric });
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
