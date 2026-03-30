// POST /api/stripe/portal — Stripe Customer Portal セッション作成
// セキュリティ: 認証必須 + owner/parent ロールのみ + tenantId はサーバー側から取得

import { requireTenantId } from '$lib/server/auth/factory';
import { createPortalSession } from '$lib/server/services/stripe-service';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);

	const role = locals.context?.role;
	if (role !== 'owner' && role !== 'parent') {
		error(403, 'サブスクリプションの管理は保護者のみ可能です');
	}

	const result = await createPortalSession(tenantId, `${url.origin}/admin/license`);

	if ('error' in result) {
		const statusMap: Record<string, number> = {
			STRIPE_DISABLED: 503,
			TENANT_NOT_FOUND: 404,
			NO_STRIPE_CUSTOMER: 400,
		};
		const messageMap: Record<string, string> = {
			STRIPE_DISABLED: '決済機能は現在利用できません',
			TENANT_NOT_FOUND: 'アカウントが見つかりません',
			NO_STRIPE_CUSTOMER: 'サブスクリプション情報が見つかりません',
		};
		error(statusMap[result.error] ?? 500, messageMap[result.error] ?? 'エラーが発生しました');
	}

	return json({ url: result.url });
};
