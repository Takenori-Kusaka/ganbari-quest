// /auth/reset-pin — #2993 (EPIC #2990) / #3070: PIN 忘れ救済 (cognito 専用)
//
// 旧 /auth/forgot-pin (email 手入力) + /auth/reset-pin/[token] (SES magic link) を置換。
// email はセッション既知 (locals.identity.email) のため手入力させない。本人確認は認証種別で分岐:
//   - password ユーザ: アカウントパスワードの再入力 (Apple Screen Time 同型、#2993)
//   - federated (Google) ユーザ: 登録メールに送る 6 桁の確認コード = email-OTP (#3070)
//     (recent-login は共有端末で silent SSO 無入力通過し得るため OTP に置換)

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const identity = locals.identity;
	if (!identity || identity.type !== 'cognito') {
		// local / anonymous では本画面は提供しない (local の救済は operator reset #2994)。
		// 未ログインの cognito ユーザもここに来ない (hooks が /auth/login へ誘導する) が、
		// 直接アクセスへの保険として login へ流す。
		redirect(302, '/auth/login');
	}

	return {
		accountEmail: identity.email,
		isFederated: identity.isFederated ?? false,
	};
};
