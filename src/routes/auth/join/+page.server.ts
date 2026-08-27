// /auth/join — 招待受諾に失敗した人が留まる画面 (#4636)
//
// 「membership 未確定」を異常ではなく **正規の状態** として扱う画面 (#4636 設計判断 3)。
// Cognito のサインアップ (IdP 側) と AuthUser 行は受諾試行より前に確定するため、受諾に失敗した
// 時点で「AuthUser はあるが membership が無い」ユーザーが必ず生まれる。IdP 側の巻き戻しは
// 失敗しうるので「戻す」のではなく、この状態のまま安全に留まれて、次アクションを本人が選べる
// 着地先を用意する。
//
// - 理由は招待 cookie からその都度再導出する (`previewInviteAcceptance`)。1 回限りの通知
//   cookie を廃止したため、リロードでもブックマークからの再訪でも同じ理由が出る。
// - 受諾できる状態に戻っていれば /admin へ送り返す (次のリクエストで自動的に合流する)。
// - 「新しく家族グループを作る」は明示操作のみ。冪等 (`provisionOwnTenant` が membership を再確認)。

import { fail, redirect } from '@sveltejs/kit';
import { getInviteJoinBlockedMessage } from '$lib/domain/labels';
import { CONTEXT_COOKIE_NAME, INVITE_COOKIE_NAME } from '$lib/domain/validation/auth';
import { provisionOwnTenant } from '$lib/server/auth/provisioning';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { previewInviteAcceptance } from '$lib/server/services/invite-service';
import type { Actions, PageServerLoad } from './$types';

/**
 * アプリ DB の `users.user_id` を解決する (#4643)。
 * IdP の sub (`identity.userId`) は `users.user_id` ではないため、フォールバックに使わない。
 * users 行がまだ無ければ null (= 所有者依存の判定は行わない)。
 */
async function resolveAppUserId(locals: App.Locals, email: string): Promise<string | null> {
	if (locals.context?.userId) return locals.context.userId;
	const existing = await getRepos().auth.findUserByEmail(email);
	return existing?.userId ?? null;
}

export const load: PageServerLoad = async ({ locals, cookies }) => {
	// 未ログインならここに留まる意味がない (ログインしないと状態が確定しない)
	if (!locals.identity || locals.identity.type !== 'cognito') {
		redirect(302, '/auth/login');
	}

	// 既に所属が確定している人がブックマーク等で来た場合は本来の画面へ戻す (dead-end にしない)
	if (locals.context) {
		redirect(302, locals.context.role === 'child' ? '/switch' : '/admin');
	}

	const inviteCode = cookies.get(INVITE_COOKIE_NAME);
	if (!inviteCode) {
		return { blockedReason: null, message: null };
	}

	const userId = await resolveAppUserId(locals, locals.identity.email);
	const reason = await previewInviteAcceptance(inviteCode, userId, locals.identity.email, {
		emailVerified: locals.identity.emailVerified,
	});

	// 原因が解消済み (メール確認が済んだ等) → 通常経路へ戻せば次の resolveContext で合流する
	if (reason === null) {
		redirect(302, '/admin');
	}

	return { blockedReason: reason, message: getInviteJoinBlockedMessage(reason) };
};

export const actions: Actions = {
	/** 「新しく自分の家族グループを作る」— 明示操作のみ。連打 / リロードで二重作成しない。 */
	createFamily: async ({ locals, cookies }) => {
		if (!locals.identity || locals.identity.type !== 'cognito') {
			redirect(302, '/auth/login');
		}

		const membership = await provisionOwnTenant(locals.identity.email);
		if (!membership) {
			logger.error('[AUTH] Explicit family creation failed', {
				context: { email: locals.identity.email },
			});
			return fail(500, { createFailed: true });
		}

		// 招待での参加はやめる選択なので招待 cookie を破棄する (再訪で受諾を試みない)
		cookies.delete(INVITE_COOKIE_NAME, { path: '/' });
		// 未確定時に発行されていない / 古い context を残さない (次のリクエストで再発行させる)
		cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });

		redirect(303, '/admin');
	},
};
