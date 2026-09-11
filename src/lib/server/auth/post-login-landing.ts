// src/lib/server/auth/post-login-landing.ts
// ログイン直後の着地先を決める SSOT (#4641)。
//
// 旧実装は経路を問わず `/admin` に送っていた。子供ロールは `/admin` に入れないため、
// ログインした瞬間に認可層で弾かれ `/switch?reason=admin_forbidden` へ跳ね返され、
// 「おやのアカウントでログインしてね」という**身に覚えのない警告**を最初に見せられていた。
// ログイン直後に所属とロールを解決し、最初から正しい画面へ送る。

import type { RequestEvent } from '@sveltejs/kit';
import { getChildById } from '$lib/server/services/child-service';
import { getAuthProvider } from './factory';
import { readSelectedChildId, setSelectedChildCookie } from './selected-child-cookie';
import type { AuthContext, Identity } from './types';

/** 親 (owner / parent) の着地先。 */
export const PARENT_LANDING = '/admin';
/** 子供の着地先 (どのプロフィールとして使うかが未確定のとき)。 */
export const CHILD_LANDING = '/switch';
/** 所属が確定していない人の着地先 (#4636)。 */
export const UNDECIDED_LANDING = '/auth/join';

/**
 * ログイン直後の着地先を決める。
 *
 * context を解決できない = 所属が未確定 (招待受諾に失敗した / provisioning に失敗した) なので、
 * 理由と次アクションを持つ `/auth/join` に送る (#4636)。
 *
 * @param preferredPath 呼び出し側が指定したい着地先 (OAuth の `oauth_next` 等)。
 *   **子供ロールには適用しない** — 親向け画面が入っていると弾かれて元の跳ね返りに戻るため。
 */
export async function resolvePostLoginLanding(
	event: RequestEvent,
	identity: Identity,
	preferredPath?: string,
): Promise<string> {
	const context = await getAuthProvider().resolveContext(event, identity);
	if (!context) return UNDECIDED_LANDING;
	if (context.role === 'child') return resolveChildLanding(event, context);
	return preferredPath ?? PARENT_LANDING;
}

/**
 * 子供の着地先。使うプロフィールが一意に決まるならホームへ直行する (#4641 AC1)。
 *
 * **自動で送るのはログイン直後のこの 1 回だけ**。`/switch` 側で同じことをすると、子供用ナビの
 * 「きりかえ」と自動スリープ (#1292) がこの画面へ来られなくなる (ボタンが無反応になり、
 * 15 分の休憩導線が消える)。
 *
 * cookie は送る前に確定させる — 無いまま送ると child layout が「未選択」と判断して `/switch` に
 * 戻し、往復になる。
 */
async function resolveChildLanding(event: RequestEvent, context: AuthContext): Promise<string> {
	const childId = context.childId ?? readSelectedChildId(event.cookies);
	if (!childId) return CHILD_LANDING;

	// 実在確認 (消された子供 / 別世帯の stale cookie で存在しないホームへ送らない)
	const child = await getChildById(childId, context.tenantId).catch(() => null);
	if (!child) return CHILD_LANDING;

	setSelectedChildCookie(event.cookies, child.id);
	return `/${child.uiMode ?? 'preschool'}/home`;
}

/** role から着地先を引く (context が既に手元にある呼び出し側用)。 */
export function landingForRole(role: string): string {
	return role === 'child' ? CHILD_LANDING : PARENT_LANDING;
}
