import { fail, redirect } from '@sveltejs/kit';
import {
	pinSchema,
	SESSION_COOKIE_NAME,
	SESSION_MAX_AGE_SECONDS,
} from '$lib/domain/validation/auth';
import { requireTenantId } from '$lib/server/auth/factory';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { login } from '$lib/server/services/auth-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const pin = formData.get('pin');

		// バリデーション
		const parsed = pinSchema.safeParse(pin);
		if (!parsed.success) {
			return fail(400, {
				error: 'おやカギコードは4〜6桁の数字を入力してください',
			});
		}

		// 認証
		const result = await login(parsed.data, tenantId);

		if ('error' in result) {
			if (result.error === 'LOCKED_OUT') {
				return fail(429, {
					error: 'ロックされています。しばらくしてからもう一度お試しください',
				});
			}
			return fail(401, {
				error: 'おやカギコードがちがいます',
			});
		}

		// 成功: セッションCookie設定
		cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: COOKIE_SECURE,
			maxAge: SESSION_MAX_AGE_SECONDS,
		});

		redirect(302, '/admin');
	},
};
