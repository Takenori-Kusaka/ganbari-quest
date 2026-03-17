import {
	SESSION_COOKIE_NAME,
	SESSION_MAX_AGE_SECONDS,
	pinSchema,
} from '$lib/domain/validation/auth';
import { login } from '$lib/server/services/auth-service';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const formData = await request.formData();
		const pin = formData.get('pin');

		// バリデーション
		const parsed = pinSchema.safeParse(pin);
		if (!parsed.success) {
			return fail(400, {
				error: 'PINは4〜6桁の数字を入力してください',
			});
		}

		// 認証
		const result = login(parsed.data);

		if ('error' in result) {
			if (result.error === 'LOCKED_OUT') {
				return fail(429, {
					error: 'ロックされています。しばらくしてからもう一度お試しください',
				});
			}
			if (result.error === 'PIN_NOT_SET') {
				return fail(500, {
					error: 'PINが設定されていません',
				});
			}
			return fail(401, {
				error: 'PINがちがいます',
			});
		}

		// 成功: セッションCookie設定
		cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: false,
			maxAge: SESSION_MAX_AGE_SECONDS,
		});

		redirect(302, '/admin');
	},
};
