// src/lib/server/auth/providers/local.ts
// LocalAuthProvider — 現行PIN認証の動作を完全に再現する AuthProvider 実装

import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '$lib/domain/validation/auth';
import { validateSession } from '$lib/server/services/auth-service';
import type { RequestEvent } from '@sveltejs/kit';
import type { AuthContext, AuthProvider, AuthResult, Identity } from '../types';

export class LocalAuthProvider implements AuthProvider {
	async resolveIdentity(event: RequestEvent): Promise<Identity | null> {
		const sessionToken = event.cookies.get(SESSION_COOKIE_NAME);
		if (!sessionToken) return null;

		const result = await validateSession(sessionToken);
		if (!result.valid) return null;

		// セッションがリフレッシュされた場合、Cookieも更新
		if (result.refreshed) {
			event.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: false,
				maxAge: SESSION_MAX_AGE_SECONDS,
			});
		}

		return { type: 'pin', sessionId: sessionToken };
	}

	async resolveContext(
		_event: RequestEvent,
		identity: Identity | null,
	): Promise<AuthContext | null> {
		if (!identity) return null;
		// ローカル版は単一テナント、常に owner
		return {
			tenantId: 'local',
			role: 'owner',
			licenseStatus: 'none',
		};
	}

	authorize(path: string, identity: Identity | null, _context: AuthContext | null): AuthResult {
		// /admin/* は認証必須
		if (path.startsWith('/admin') && !identity) {
			return { allowed: false, redirect: '/login' };
		}
		// 認証済みで /login にアクセスしたら /admin へ
		if (path === '/login' && identity) {
			return { allowed: false, redirect: '/admin' };
		}
		return { allowed: true };
	}
}
