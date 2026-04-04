// /auth/invite/[code] — 招待リンクランディングページ (#0129)
// 招待コードを検証し、ログイン/サインアップへ誘導する

import { redirect } from '@sveltejs/kit';
import { INVITE_COOKIE_NAME } from '$lib/domain/validation/auth';
import { getRepos } from '$lib/server/db/factory';
import { getInvite } from '$lib/server/services/invite-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
	const { code } = params;

	// 招待コードの有効性チェック
	const invite = await getInvite(code);
	if (!invite) {
		return {
			valid: false as const,
			error: 'この招待リンクは無効または期限切れです。',
		};
	}

	// 既にログイン済みのユーザー → テナント所属チェック (#0203)
	if (locals.identity && locals.identity.type === 'cognito') {
		const existingTenants = await getRepos().auth.findUserTenants(locals.identity.userId);
		if (existingTenants.length > 0) {
			// 既にテナント所属 → 招待 Cookie を保存せず警告表示
			cookies.delete(INVITE_COOKIE_NAME, { path: '/' });
			return {
				valid: false as const,
				error: '既に別のグループに所属しているため、この招待を受けることはできません。',
			};
		}

		// テナント未所属 → 招待処理をトリガー
		cookies.set(INVITE_COOKIE_NAME, code, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: 60 * 10, // 10分（#0203: リスク軽減）
		});
		cookies.delete('context_token', { path: '/' });
		redirect(302, '/admin');
	}

	// 未ログインユーザー → Cookie に保存してログイン/サインアップへ誘導
	cookies.set(INVITE_COOKIE_NAME, code, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: 60 * 10, // 10分（#0203: リスク軽減）
	});

	return {
		valid: true as const,
		invite: {
			role: invite.role,
			childId: invite.childId,
			expiresAt: invite.expiresAt,
		},
	};
};
