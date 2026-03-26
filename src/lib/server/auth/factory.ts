// src/lib/server/auth/factory.ts
// AUTH_MODE 環境変数による AuthProvider 切り替え

import { CognitoAuthProvider } from './providers/cognito';
import { DevCognitoAuthProvider } from './providers/cognito-dev';
import { LocalAuthProvider } from './providers/local';
import type { AuthMode, AuthProvider } from './types';

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
