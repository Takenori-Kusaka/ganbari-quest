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
 * child ロールの場合、指定された childId が自分のものであるかチェック。
 * owner/parent は常に許可。child は context.childId と一致しなければ 403。
 */
export function requireChildAccess(locals: App.Locals, requestedChildId: number): void {
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
