// src/lib/server/auth/providers/cognito-dev.ts
// 開発用 CognitoAuthProvider（COGNITO_DEV_MODE=true）
// 実際の AWS Cognito なしでログイン/認可フローをテスト可能にする

import { CONTEXT_COOKIE_NAME, IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { logger } from '$lib/server/logger';
import type { RequestEvent } from '@sveltejs/kit';
import { authorizeCognito } from '../authorization';
import { getContextMaxAge, signContext, verifyContext } from '../context-token';
import type { AuthContext, AuthProvider, AuthResult, Identity, Role } from '../types';
import { verifyDevIdentityToken } from './cognito-dev-jwt';

/**
 * 開発用ダミーユーザー（E2E テストでも使用）
 * ログインフォームでこれらの email/password でログイン可能
 */
export interface DevUser {
	userId: string;
	email: string;
	password: string;
	tenantId: string;
	role: Role;
}

export const DEV_USERS: DevUser[] = [
	{
		userId: 'dev-owner-001',
		email: 'owner@example.com',
		password: 'Gq!Dev#Owner2026x',
		tenantId: 'dev-tenant-001',
		role: 'owner',
	},
	{
		userId: 'dev-parent-001',
		email: 'parent@example.com',
		password: 'Gq!Dev#Parent2026',
		tenantId: 'dev-tenant-001',
		role: 'parent',
	},
	{
		userId: 'dev-child-001',
		email: 'child@example.com',
		password: 'Gq!Dev#Child2026x',
		tenantId: 'dev-tenant-001',
		role: 'child',
	},
];

/** Email でダミーユーザーを検索 */
export function findDevUser(email: string): DevUser | undefined {
	return DEV_USERS.find((u) => u.email === email);
}

/** Email + Password でダミー認証（成功なら DevUser、失敗なら null） */
export function authenticateDevUser(email: string, password: string): DevUser | null {
	const user = DEV_USERS.find((u) => u.email === email && u.password === password);
	return user ?? null;
}

export class DevCognitoAuthProvider implements AuthProvider {
	async resolveIdentity(event: RequestEvent): Promise<Identity | null> {
		const idToken = event.cookies.get(IDENTITY_COOKIE_NAME);
		if (!idToken) return null;

		try {
			const claims = await verifyDevIdentityToken(idToken);
			if (claims) {
				return {
					type: 'cognito',
					userId: claims.sub,
					email: claims.email,
				};
			}
		} catch (e) {
			logger.warn('[AUTH-DEV] Identity token verification failed', {
				context: { error: e instanceof Error ? e.message : String(e) },
			});
		}

		return null;
	}

	async resolveContext(
		event: RequestEvent,
		identity: Identity | null,
	): Promise<AuthContext | null> {
		if (!identity) return null;

		// 既存 Context Token を検証
		const contextToken = event.cookies.get(CONTEXT_COOKIE_NAME);
		if (contextToken) {
			const context = verifyContext(contextToken);
			if (context) return context;
		}

		// Context Token なし → ダミーメンバーシップから発行
		return this.issueContextFromDevUsers(event, identity);
	}

	authorize(path: string, identity: Identity | null, context: AuthContext | null): AuthResult {
		return authorizeCognito(path, identity, context);
	}

	private issueContextFromDevUsers(event: RequestEvent, identity: Identity): AuthContext | null {
		if (identity.type !== 'cognito') return null;

		const devUser = findDevUser(identity.email);
		if (!devUser) return null;

		const context: AuthContext = {
			tenantId: devUser.tenantId,
			role: devUser.role,
			licenseStatus: 'active',
			tenantStatus: 'active',
		};

		const token = signContext(context);
		event.cookies.set(CONTEXT_COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: COOKIE_SECURE,
			maxAge: getContextMaxAge(context),
		});

		return context;
	}
}
