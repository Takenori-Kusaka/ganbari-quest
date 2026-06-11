// /auth/reset-pin — #2993 (EPIC #2990): PIN 忘れ救済 (cognito 専用、パスワード再入力方式)
//
// 旧 /auth/forgot-pin (email 手入力) + /auth/reset-pin/[token] (SES magic link) を置換。
// email はセッション既知 (locals.identity.email) のため手入力させず、本人確認は
// アカウントパスワードの再入力で行う (Apple Screen Time 同型、Issue #2993 設計コメント)。

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
	};
};
