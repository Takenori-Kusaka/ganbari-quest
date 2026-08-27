import type { ChildId } from '$lib/domain/ids';
// src/lib/server/auth/guards.ts
// 認証ガード関数（純粋関数 — DB 依存なし）

import { error } from '@sveltejs/kit';
import type { Role } from './types';

/** 認証済みルートから tenantId を安全に取得。未認証ならエラー。 */
export function requireTenantId(locals: App.Locals): string {
	if (!locals.context) {
		throw new Error('Unauthorized: missing auth context');
	}
	return locals.context.tenantId;
}

/**
 * 認証済みルートから **アプリ DB の `users.user_id`** を取得する (#4643)。
 *
 * `locals.identity.userId` は IdP (Cognito) の sub であり `users.user_id` ではない。
 * memberships / invites / children / consents はすべて後者を参照するため、sub を渡すと
 * 一致するレコードが無く「削除したのに消えない」「本人判定が効かない」が静かに起きる。
 * 取り違えを型と実行時の両方で塞ぐため、DB を触る route は必ず本関数から取る。
 *
 * cognito 系 provider のみ `context.userId` を発行する。local / anonymous は users 行を
 * 持たないため 401 にする (fail-closed。sub へのフォールバックは作らない)。
 */
export function requireAppUserId(locals: App.Locals): string {
	const userId = locals.context?.userId;
	if (!userId) {
		throw error(401, 'Unauthorized');
	}
	return userId;
}

/**
 * child ロールの場合、指定された childId が自分のものであるかチェック。
 * owner/parent は常に許可。child は context.childId と一致しなければ 403。
 */
export function requireChildAccess(locals: App.Locals, requestedChildId: ChildId): void {
	if (!locals.context) {
		throw error(401, 'Unauthorized');
	}
	if (locals.context.role === 'child' && locals.context.childId !== requestedChildId) {
		throw error(403, 'Access denied');
	}
}

/** ロールが指定のいずれかであることを検証。不一致なら 403。 */
export function requireRole(locals: App.Locals, allowedRoles: Role[]): void {
	if (!locals.context) {
		throw error(401, 'Unauthorized');
	}
	if (!allowedRoles.includes(locals.context.role)) {
		throw error(403, 'Forbidden');
	}
}
