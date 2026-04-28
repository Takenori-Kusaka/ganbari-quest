// src/routes/unsubscribe/[token]/+page.server.ts
// #1601: 配信停止 (List-Unsubscribe one-click + 確認画面) ルート。
//
// RFC 8058 仕様により List-Unsubscribe-Post: List-Unsubscribe=One-Click では
// POST 1 回で確実に opt-out できる必要がある。本ルートは:
//   - GET: 確認画面を表示 (人間ユーザー向け、誤クリック防止)
//   - POST (form action): opt-out を実行して完了画面を表示
//
// 認証は不要 (HMAC トークンが認証代わり)。

import { fail } from '@sveltejs/kit';
import {
	isTenantUnsubscribed,
	markTenantUnsubscribed,
} from '$lib/server/services/lifecycle-email-service';
import { verifyUnsubscribeToken } from '$lib/server/services/unsubscribe-token';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const payload = verifyUnsubscribeToken(params.token);
	if (!payload) {
		return {
			tokenValid: false as const,
			alreadyUnsubscribed: false,
			done: false,
		};
	}

	const alreadyUnsubscribed = await isTenantUnsubscribed(payload.tenantId);
	return {
		tokenValid: true as const,
		alreadyUnsubscribed,
		done: false,
	};
};

export const actions: Actions = {
	default: async ({ params }) => {
		const payload = verifyUnsubscribeToken(params.token);
		if (!payload) {
			return fail(400, { error: 'invalid-token' });
		}
		await markTenantUnsubscribed(payload.tenantId);
		return { success: true };
	},
};
