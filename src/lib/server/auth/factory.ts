// src/lib/server/auth/factory.ts
// AUTH_MODE 環境変数による AuthProvider 切り替え
// ADR-0048: AUTH_MODE=anonymous は Multi-Lambda demo deployment 専用

import { AnonymousAuthProvider } from './providers/anonymous';
import { CognitoAuthProvider } from './providers/cognito';
import { DevCognitoAuthProvider } from './providers/cognito-dev';
import { LocalAuthProvider } from './providers/local';
import type { AuthMode, AuthProvider } from './types';

// Guard 関数は guards.ts に分離（DB 依存なし）。後方互換のため re-export。
// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { requireChildAccess, requireRole, requireTenantId } from './guards';

let _provider: AuthProvider | null = null;

/** 現在の認証モードを取得 */
export function getAuthMode(): AuthMode {
	return (process.env.AUTH_MODE ?? 'local') as AuthMode;
}

/** 開発モード（COGNITO_DEV_MODE=true）かどうか */
export function isCognitoDevMode(): boolean {
	return process.env.COGNITO_DEV_MODE === 'true';
}

export function getAuthProvider(): AuthProvider {
	if (_provider) return _provider;

	const mode = (process.env.AUTH_MODE ?? 'local') as AuthMode;

	if (mode === 'anonymous') {
		// ADR-0048 §決定 P-1.6: Multi-Lambda demo deployment 用 anonymous provider
		_provider = new AnonymousAuthProvider();
	} else if (mode === 'cognito') {
		_provider = isCognitoDevMode() ? new DevCognitoAuthProvider() : new CognitoAuthProvider();
	} else {
		_provider = new LocalAuthProvider();
	}

	return _provider;
}
