// /auth/login — Cognito Hosted UI へリダイレクト
// AUTH_MODE=cognito 時のみ使用

import { buildAuthorizeUrl } from '$lib/server/auth/providers/cognito-oauth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const authorizeUrl = buildAuthorizeUrl(cookies);
	redirect(302, authorizeUrl);
};
