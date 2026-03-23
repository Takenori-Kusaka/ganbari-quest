// src/lib/server/auth/providers/cognito.ts
// CognitoAuthProvider — Email/Password + MFA + マルチテナント (#0123)

import { CONTEXT_COOKIE_NAME, IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import type { RequestEvent } from '@sveltejs/kit';
import { authorizeCognito } from '../authorization';
import { getContextMaxAge, signContext, verifyContext } from '../context-token';
import type { AuthContext, AuthProvider, AuthResult, Identity } from '../types';
import { verifyIdentityToken } from './cognito-jwt';

export class CognitoAuthProvider implements AuthProvider {
	/**
	 * Layer 1: Identity 解決
	 * Cognito JWT（identity_token Cookie）から Identity を取得
	 */
	async resolveIdentity(event: RequestEvent): Promise<Identity | null> {
		const idToken = event.cookies.get(IDENTITY_COOKIE_NAME);
		if (!idToken) return null;

		try {
			const claims = await verifyIdentityToken(idToken);
			if (claims) {
				return {
					type: 'cognito',
					userId: claims.sub,
					email: claims.email,
				};
			}
		} catch (e) {
			logger.warn('[AUTH] Identity token verification failed', {
				context: { error: e instanceof Error ? e.message : String(e) },
			});
		}

		return null;
	}

	/**
	 * Layer 2: Context 解決
	 * context_token Cookie から署名付きトークンをデコード。
	 * 期限切れの場合は DynamoDB メンバーシップから再発行。
	 */
	async resolveContext(
		event: RequestEvent,
		identity: Identity | null,
	): Promise<AuthContext | null> {
		if (!identity) return null;

		// 1. 既存の Context Token を検証
		const contextToken = event.cookies.get(CONTEXT_COOKIE_NAME);
		if (contextToken) {
			const context = verifyContext(contextToken);
			if (context) return context;
		}

		// 2. Context Token なしまたは期限切れ → メンバーシップから再発行
		return this.issueContextFromMembership(event, identity);
	}

	authorize(path: string, identity: Identity | null, context: AuthContext | null): AuthResult {
		return authorizeCognito(path, identity, context);
	}

	/**
	 * DynamoDB メンバーシップから Context を再発行
	 * #0123: 1ユーザー=1家族グループ（複数テナント所属なし）
	 */
	private async issueContextFromMembership(
		event: RequestEvent,
		identity: Identity,
	): Promise<AuthContext | null> {
		try {
			if (identity.type !== 'cognito') return null;

			// メンバーシップから取得（1ユーザー=1テナント）
			const memberships = await getRepos().auth.findUserTenants(identity.userId);
			if (memberships.length === 0) return null;

			const membership = memberships[0];
			if (!membership) return null;

			// ライセンス状態の取得（将来実装、現在は active 固定）
			const context: AuthContext = {
				tenantId: membership.tenantId,
				role: membership.role,
				licenseStatus: 'active',
			};
			this.setContextCookie(event, context);
			return context;
		} catch (e) {
			logger.error('[AUTH] Failed to issue context from membership', {
				error: e instanceof Error ? e.message : String(e),
			});
		}

		return null;
	}

	private setContextCookie(event: RequestEvent, context: AuthContext): void {
		const token = signContext(context);
		event.cookies.set(CONTEXT_COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: getContextMaxAge(context),
		});
	}
}
