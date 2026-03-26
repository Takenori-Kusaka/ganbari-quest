// src/lib/server/auth/factory.ts
// AUTH_MODE 環境変数による AuthProvider 切り替え

import { error } from '@sveltejs/kit';
import { CognitoAuthProvider } from './providers/cognito';
import { DevCognitoAuthProvider } from './providers/cognito-dev';
import { LocalAuthProvider } from './providers/local';
import type { AuthMode, AuthProvider, Role } from './types';

let _provider: AuthProvider | null = null;

/** 現在の認証モードを取得 */
export function getAuthMode(): AuthMode {
	return (process.env.AUTH_MODE ?? 'local') as AuthMode;
}

/** 開発モード（COGNITO_DEV_MODE=true）かどうか */
export function isCognitoDevMode(): boolean {
	return process.env.COGNITO_DEV_MODE === 'true';
}

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

export function getAuthProvider(): AuthProvider {
	if (_provider) return _provider;

	const mode = (process.env.AUTH_MODE ?? 'local') as AuthMode;

	if (mode === 'cognito') {
		_provider = isCognitoDevMode() ? new DevCognitoAuthProvider() : new CognitoAuthProvider();
	} else {
		_provider = new LocalAuthProvider();
	}

	return _provider;
}
