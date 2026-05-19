// /admin/rewards/requests — ごほうび申請承認画面 (#2269)
//
// 子#2 (#2268) で /admin/rewards から申請タブ表示を削除。
// 本画面で承認/却下フローを専用 URL に分離する (CRUD と承認フローの責務分離)。
// service 層は既存 reward-redemption-service.ts を再利用。

import { fail } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	approveRedemption,
	getRedemptionRequestsForParent,
	rejectRedemption,
} from '$lib/server/services/reward-redemption-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	// pending + 最近30件の承認/却下履歴を取得
	const [pendingRequests, historyRequests] = await Promise.all([
		getRedemptionRequestsForParent(tenantId, { status: 'pending_parent_approval' }),
		getRedemptionRequestsForParent(tenantId, { limit: 30 }).then((requests) =>
			requests.filter((r) => r.status === 'approved' || r.status === 'rejected'),
		),
	]);

	return {
		pendingRequests,
		historyRequests,
	};
};

export const actions: Actions = {
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
