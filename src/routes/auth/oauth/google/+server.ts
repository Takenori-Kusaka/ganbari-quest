// /auth/oauth/google — Google OAuth 開始エンドポイント
// Cognito の authorize URL に identity_provider=Google を付与してリダイレクト

import { buildAuthorizeUrl } from '$lib/server/auth/providers/cognito-oauth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const url = buildAuthorizeUrl(cookies, 'Google');
	redirect(302, url);
};
