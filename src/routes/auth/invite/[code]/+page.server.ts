// /auth/invite/[code] — 招待リンクランディングページ (#0129)
// 招待コードを検証し、ログイン/サインアップへ誘導する

import { INVITE_COOKIE_NAME } from '$lib/domain/validation/auth';
import { getInvite } from '$lib/server/services/invite-service';
import { redirect } from '@sveltejs/kit';
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

	// 招待コードを Cookie に保存（ログイン/サインアップ後に消費）
	cookies.set(INVITE_COOKIE_NAME, code, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: 60 * 60, // 1時間（操作中に消えないよう十分な時間）
	});

	// 既にログイン済みのユーザー → 直接テナント参加を試行
	if (locals.identity) {
		// context があれば既にテナント所属 → 招待受諾は CognitoProvider が行う
		// context cookie をクリアして再発行させる（招待処理をトリガー）
		cookies.delete('context_token', { path: '/' });
		redirect(302, '/admin');
	}

	return {
		valid: true as const,
		invite: {
			role: invite.role,
			childId: invite.childId,
			expiresAt: invite.expiresAt,
		},
	};
};
