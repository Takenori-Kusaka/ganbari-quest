// POST /api/stripe/checkout — Stripe Checkout Session 作成
// セキュリティ: 認証必須 + owner/parent ロールのみ + tenantId はサーバー側から取得（改ざん不可）

import { error, json } from '@sveltejs/kit';
import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { requireTenantId } from '$lib/server/auth/factory';
import { createCheckoutSession } from '$lib/server/services/stripe-service';
import type { RequestHandler } from './$types';

/** オープンリダイレクト防止: returnPath は相対パス（/ 始まり）のみ許可 */
function validateReturnPath(path: string | undefined): string {
	if (!path) return '/admin';
	if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
		return '/admin';
	}
	return path;
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	// 認証 + テナント検証（サーバー側の署名付きContextから取得 — 偽造不可）
	const tenantId = requireTenantId(locals);

	// ロールチェック: owner/parent のみ決済操作を許可
	const role = locals.context?.role;
	if (role !== 'owner' && role !== 'parent') {
		error(403, 'サブスクリプションの管理は保護者のみ可能です');
	}

	const body = await request.json();
	const planId = body.planId;
	const returnPath: string | undefined = body.returnPath;
	const validPlanIds: string[] = [
		LICENSE_PLAN.MONTHLY,
		LICENSE_PLAN.YEARLY,
		LICENSE_PLAN.FAMILY_MONTHLY,
		LICENSE_PLAN.FAMILY_YEARLY,
	];
	if (!validPlanIds.includes(planId)) {
		error(400, 'プランが正しくありません');
	}

	const origin = url.origin;
	// #767: returnPath が指定された場合、Checkout 完了後にその画面に戻す
	// オープンリダイレクト防止: 相対パスのみ許可
	const safePath = validateReturnPath(returnPath);
	const successBase = returnPath ? safePath : '/admin/license';
	const successUrl = `${origin}${successBase}${successBase.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
	const cancelUrl = returnPath ? `${origin}${safePath}` : `${origin}/pricing`;

	const result = await createCheckoutSession({
		tenantId,
		planId,
		successUrl,
		cancelUrl,
	});

	if ('error' in result) {
		const statusMap: Record<string, number> = {
			STRIPE_DISABLED: 503,
			TENANT_NOT_FOUND: 404,
			ALREADY_SUBSCRIBED: 409,
			INVALID_PLAN: 400,
		};
		const messageMap: Record<string, string> = {
			STRIPE_DISABLED: '決済機能は現在利用できません',
			TENANT_NOT_FOUND: 'アカウントが見つかりません',
			ALREADY_SUBSCRIBED: '既にサブスクリプションに加入済みです',
			INVALID_PLAN: 'プランが正しくありません',
		};
		error(statusMap[result.error] ?? 500, messageMap[result.error] ?? 'エラーが発生しました');
	}

	return json({ url: result.url });
};
