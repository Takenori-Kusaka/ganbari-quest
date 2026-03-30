// src/routes/ops/+layout.server.ts
// OPS ダッシュボード認証: Bearer token (#0176)

import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ request, cookies }) => {
	const secret = process.env.OPS_SECRET_KEY;

	if (!secret) {
		// OPS_SECRET_KEY 未設定時は ops ダッシュボード無効
		error(404, 'Not Found');
	}

	// Bearer token (API / curl) または cookie (ブラウザセッション) で認証
	const authHeader = request.headers.get('Authorization');
	const cookieToken = cookies.get('ops_token');

	if (authHeader === `Bearer ${secret}` || cookieToken === secret) {
		return {};
	}

	// URL パラメータでのトークン渡し（初回アクセス用） → cookie にセット
	const url = new URL(request.url);
	const tokenParam = url.searchParams.get('token');
	if (tokenParam === secret) {
		cookies.set('ops_token', secret, {
			path: '/ops',
			httpOnly: true,
			secure: process.env.AUTH_MODE === 'cognito',
			sameSite: 'strict',
			maxAge: 60 * 60 * 24, // 24 hours
		});
		return {};
	}

	error(401, 'Unauthorized');
};
