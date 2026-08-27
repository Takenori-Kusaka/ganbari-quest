// /admin/rewards/requests — ごほうび申請承認画面 (#2269)
//
// 子#2 (#2268) で /admin/rewards から申請タブ表示を削除。
// 本画面で承認/却下フローを専用 URL に分離する (CRUD と承認フローの責務分離)。
// service 層は既存 reward-redemption-service.ts を再利用。

import { fail } from '@sveltejs/kit';
import { REWARD_REQUEST_HISTORY_LIMIT } from '$lib/domain/constants/redemption-status';
import { formIdString } from '$lib/domain/form-value';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	approveRedemption,
	countPendingRedemptionsForParent,
	getRedemptionRequestsForParent,
	rejectRedemption,
} from '$lib/server/services/reward-redemption-service';
import type { Actions, PageServerLoad } from './$types';

/** #4682 F4: 履歴として出す状態 (処理済み)。 */
const RESOLVED_REDEMPTION_STATUSES = ['approved', 'rejected'] as const;

/**
 * #4682 F1: 承認待ちの表示上限。古い順に取るため、超過しても「長く待っている申請」は必ず出る。
 * 超過時は総数との差を画面に明示する (見えている件数を全件と誤解させない)。
 */
const PENDING_DISPLAY_LIMIT = 200;

// #3320: 承認/却下した保護者の認証 userId を監査証跡 (resolved_by_parent_id) に記録する。
// cognito / anonymous(demo) identity は userId(sub) を持つ。local 実行モードは userId を
// 持たないため null (= 解決者不明)。旧実装は parentId=0 ハードコードで常に解決者不明だった。
function resolverUserId(locals: App.Locals): string | null {
	const id = locals.identity;
	if (id && (id.type === 'cognito' || id.type === 'anonymous')) return id.userId;
	return null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	// #4682 F1: 承認待ちは **古い順** に取る。既定の新しい順 + limit 50 だと、
	// 一番長く待っている申請が window の外に落ちて画面に出ず、親が永久に処理できない
	// (実測: pending 61 件で最古 11 件が不可視、見出しの件数も「50 件」と嘘になっていた)。
	// #4682 F4: 履歴は「直近 30 申請の中の処理済み」ではなく「処理済みの直近 30 件」。
	// 表示件数は REWARD_REQUEST_HISTORY_LIMIT SSOT (labels の見出しと同じ定数) を引く。
	// 承認待ちの件数は COUNT (limit なし) で取り、表示件数と混同しない。
	const [pendingRequests, historyRequests, pendingTotal] = await Promise.all([
		getRedemptionRequestsForParent(tenantId, {
			status: 'pending_parent_approval',
			order: 'asc',
			limit: PENDING_DISPLAY_LIMIT,
		}),
		getRedemptionRequestsForParent(tenantId, {
			statuses: RESOLVED_REDEMPTION_STATUSES,
			limit: REWARD_REQUEST_HISTORY_LIMIT,
		}),
		countPendingRedemptionsForParent(tenantId),
	]);

	return {
		pendingRequests,
		historyRequests,
		/** 承認待ちの正確な総数 (COUNT)。表示件数 `pendingRequests.length` と区別する。 */
		pendingTotal,
	};
};

export const actions: Actions = {
	approveRedemption: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const requestId = formIdString(formData.get('requestId'));
		if (!requestId) return fail(400, { redemptionError: '申請IDが不正です' });

		// #3320: 認証済み identity の userId を監査証跡として記録 (旧: parentId=0 ハードコード)
		const result = await approveRedemption(requestId, resolverUserId(locals), tenantId);
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
		const requestId = formIdString(formData.get('requestId'));
		const parentNote = String(formData.get('parentNote') ?? '').trim() || null;
		if (!requestId) return fail(400, { redemptionError: '申請IDが不正です' });

		// #3320: 却下も承認と対称に解決者 userId を記録
		const result = await rejectRedemption(requestId, parentNote, tenantId, resolverUserId(locals));
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
