// src/lib/server/auth/providers/cognito.ts
// CognitoAuthProvider — OAuth + デバイストークン + 二層セッション

import {
	CONTEXT_COOKIE_NAME,
	DEVICE_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
} from '$lib/domain/validation/auth';
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
	 * 優先順: identity_token (OAuth JWT) > device_token
	 */
	async resolveIdentity(event: RequestEvent): Promise<Identity | null> {
		// 1. OAuth Identity Token（Cognito JWT）
		const idToken = event.cookies.get(IDENTITY_COOKIE_NAME);
		if (idToken) {
			try {
				const claims = await verifyIdentityToken(idToken);
				if (claims) {
					return {
						type: 'oauth',
						userId: claims.sub,
						email: claims.email,
					};
				}
			} catch (e) {
				logger.warn('[AUTH] Identity token verification failed', {
					context: { error: e instanceof Error ? e.message : String(e) },
				});
			}
		}

		// 2. Device Token
		const deviceToken = event.cookies.get(DEVICE_COOKIE_NAME);
		if (deviceToken) {
			try {
				const device = await getRepos().auth.findDeviceToken(deviceToken);
				if (device && device.status === 'active') {
					return {
						type: 'device',
						deviceId: device.deviceId,
						tenantId: device.tenantId,
					};
				}
			} catch (e) {
				logger.warn('[AUTH] Device token lookup failed', {
					context: { error: e instanceof Error ? e.message : String(e) },
				});
			}
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
	 */
	private async issueContextFromMembership(
		event: RequestEvent,
		identity: Identity,
	): Promise<AuthContext | null> {
		try {
			if (identity.type === 'device') {
				// デバイストークン → テナントは固定、ロールは child
				const context: AuthContext = {
					tenantId: identity.tenantId,
					role: 'child',
					licenseStatus: 'active', // デバイスアクセスではライセンスチェック省略
				};
				this.setContextCookie(event, context);
				return context;
			}

			if (identity.type === 'oauth') {
				// OAuth → メンバーシップから取得
				const memberships = await getRepos().auth.findUserTenants(identity.userId);
				if (memberships.length === 0) return null; // テナント未所属

				// 単一テナントの場合は自動選択、複数の場合は最初のテナント
				// （テナント選択画面は別途実装）
				const membership = memberships[0]!;

				// ライセンス状態の取得（将来実装、現在は active 固定）
				const context: AuthContext = {
					tenantId: membership.tenantId,
					role: membership.role,
					licenseStatus: 'active',
				};
				this.setContextCookie(event, context);
				return context;
			}
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
