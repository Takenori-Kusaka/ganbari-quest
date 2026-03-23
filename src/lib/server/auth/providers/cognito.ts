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
	 * メンバーシップがなければ初回ログインとして自動プロビジョニングする
	 */
	private async issueContextFromMembership(
		event: RequestEvent,
		identity: Identity,
	): Promise<AuthContext | null> {
		try {
			if (identity.type !== 'cognito') return null;

			const repos = getRepos();

			// メンバーシップから取得（1ユーザー=1テナント）
			let memberships = await repos.auth.findUserTenants(identity.userId);

			// 初回ログイン: AuthUser + Tenant + Membership を自動作成
			if (memberships.length === 0) {
				logger.info('[AUTH] First login detected, auto-provisioning', {
					context: { userId: identity.userId, email: identity.email },
				});
				const membership = await this.provisionNewUser(identity);
				if (!membership) return null;
				memberships = [membership];
			}

			const membership = memberships[0];
			if (!membership) return null;

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

	/**
	 * 初回ログインユーザーのプロビジョニング
	 * AuthUser → Tenant → Membership を作成し、owner ロールを付与
	 */
	private async provisionNewUser(
		identity: Extract<Identity, { type: 'cognito' }>,
	): Promise<import('$lib/server/auth/entities').Membership | null> {
		try {
			const repos = getRepos();

			// AuthUser が既にあるか確認（別経路で作成済みの場合）
			let user = await repos.auth.findUserById(identity.userId);
			if (!user) {
				user = await repos.auth.createUser({
					email: identity.email,
					provider: 'cognito',
				});
				// Cognito sub と内部 userId が異なるため、Cognito sub でも引けるよう保存
				// createUser は内部 u-<uuid> を生成するが、Cognito sub を userId として使いたい
				// → findUserByEmail で逆引きする
			}

			// Email で既存ユーザーを検索（createUser が別IDを振る場合の対応）
			const existingUser = await repos.auth.findUserByEmail(identity.email);

			const effectiveUserId = existingUser?.userId ?? user.userId;

			// 既にテナントに所属していないか再確認
			const existing = await repos.auth.findUserTenants(effectiveUserId);
			if (existing.length > 0) return existing[0] ?? null;

			// Tenant 作成（家族名はメールアドレスのローカル部から仮名を生成）
			const familyName = identity.email.split('@')[0] ?? 'family';
			const tenant = await repos.auth.createTenant({
				name: `${familyName}の家族`,
				ownerId: effectiveUserId,
			});

			// Membership 作成（初回ユーザーは owner）
			const membership = await repos.auth.createMembership({
				userId: effectiveUserId,
				tenantId: tenant.tenantId,
				role: 'owner',
			});

			logger.info('[AUTH] Auto-provisioned new user', {
				context: {
					userId: effectiveUserId,
					tenantId: tenant.tenantId,
					role: 'owner',
				},
			});

			return membership;
		} catch (e) {
			logger.error('[AUTH] Failed to provision new user', {
				error: e instanceof Error ? e.message : String(e),
			});
			return null;
		}
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
