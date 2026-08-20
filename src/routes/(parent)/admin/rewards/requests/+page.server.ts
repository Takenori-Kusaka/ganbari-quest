// /admin/rewards/requests — ごほうび申請承認画面 (#2269)
//
// 子#2 (#2268) で /admin/rewards から申請タブ表示を削除。
// 本画面で承認/却下フローを専用 URL に分離する (CRUD と承認フローの責務分離)。
// service 層は既存 reward-redemption-service.ts を再利用。

import { fail } from '@sveltejs/kit';
import { formIdString } from '$lib/domain/form-value';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	approveRedemption,
	getRedemptionRequestsForParent,
	rejectRedemption,
} from '$lib/server/services/reward-redemption-service';
import type { Actions, PageServerLoad } from './$types';

/** #4682 F4: 履歴として出す状態 (処理済み)。 */
const RESOLVED_REDEMPTION_STATUSES = ['approved', 'rejected'] as const;

/** #4682 F4: 履歴の表示件数 (labels の見出し「処理済み（直近30件）」と対応)。 */
const HISTORY_LIMIT = 30;

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

	// pending の全件 + 処理済み (approved / rejected) の直近 30 件。
	// #4682 F4: 旧実装は「直近 30 申請」を取ってから client 側で処理済みを filter していたため、
	// 承認待ちが 30 件あると履歴が 0 件表示になっていた (一覧 limit を別用途に流用する同 class)。
	// status 条件を DB 側に渡し、limit を「履歴の表示件数」として正しく効かせる。
	const [pendingRequests, historyRequests] = await Promise.all([
		getRedemptionRequestsForParent(tenantId, { status: 'pending_parent_approval' }),
		getRedemptionRequestsForParent(tenantId, {
			statuses: RESOLVED_REDEMPTION_STATUSES,
			limit: HISTORY_LIMIT,
		}),
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
