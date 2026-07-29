// /auth/invite/[code] — 招待リンクランディングページ (#0129)
// 招待コードを検証し、ログイン/サインアップへ誘導する

import { redirect } from '@sveltejs/kit';
import { AUTH_INVITE_LABELS } from '$lib/domain/labels';
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
			error: AUTH_INVITE_LABELS.invalidLink,
			errorDesc: AUTH_INVITE_LABELS.invalidLinkDesc,
			// 次アクションは「招待の再発行を依頼する」であり、ログアウトでは解決しない
			sessionActive: false,
		};
	}

	// 既にログイン済みのユーザー → テナント所属チェック (#0203)
	if (locals.identity && locals.identity.type === 'cognito') {
		// #3555 ①: 宛先 email 束縛付き招待 (#3549 判断2) は、受諾処理に入る前に
		// ログイン中 user の email と照合し、不一致なら理由 + 次アクションを案内する
		// (受諾時の INVITE_EMAIL_MISMATCH で無説明 dead-end になるのを防ぐ)。
		// 照合は invite-service と同じ case-insensitive exact 一致。
		if (invite.email && invite.email.toLowerCase() !== locals.identity.email.trim().toLowerCase()) {
			cookies.delete(INVITE_COOKIE_NAME, { path: '/' });
			return {
				valid: false as const,
				error: AUTH_INVITE_LABELS.emailMismatch,
				errorDesc: AUTH_INVITE_LABELS.emailMismatchDesc,
				// ログイン中なので、別アカウントで受け直すためのログアウト導線を出す
				sessionActive: true,
			};
		}
		const existingTenants = await getRepos().auth.findUserTenants(locals.identity.userId);
		if (existingTenants.length > 0) {
			// 既にテナント所属 → 招待 Cookie を保存せず警告表示
			cookies.delete(INVITE_COOKIE_NAME, { path: '/' });
			// #4049: errorDesc を undefined にすると画面が invalidLinkDesc (再発行依頼) に
			// フォールバックし、本経路で必要な「ログアウト → 招待リンク再タップ」案内が消える。
			// 共有端末で親が子の招待リンクを踏む標準ユースケースの唯一の出口なので専用文言を返す。
			return {
				valid: false as const,
				error: AUTH_INVITE_LABELS.alreadyInTenant,
				errorDesc: AUTH_INVITE_LABELS.alreadyInTenantDesc,
				sessionActive: true,
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
