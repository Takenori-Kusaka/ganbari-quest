// src/lib/server/auth/providers/cognito.ts
// CognitoAuthProvider — Email/Password + MFA + マルチテナント (#0123)

import type { RequestEvent } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import {
	CONTEXT_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
	INVITE_COOKIE_NAME,
} from '$lib/domain/validation/auth';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { acceptInvite, getInvite } from '$lib/server/services/invite-service';
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
					groups: claims['cognito:groups'],
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
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
	private async issueContextFromMembership(
		event: RequestEvent,
		identity: Identity,
	): Promise<AuthContext | null> {
		try {
			if (identity.type !== 'cognito') return null;

			const repos = getRepos();

			// Cognito sub → 内部 userId の解決
			// identity.userId は Cognito sub だが、DynamoDB は u-<uuid> で管理
			const existingUser = await repos.auth.findUserByEmail(identity.email);
			const internalUserId = existingUser?.userId ?? identity.userId;

			// メンバーシップから取得（1ユーザー=1テナント）
			let memberships = await repos.auth.findUserTenants(internalUserId);

			// 初回ログイン: 招待コード or 自動プロビジョニング
			if (memberships.length === 0) {
				// 招待コード Cookie があれば招待受諾を試行
				const inviteCode = event.cookies.get(INVITE_COOKIE_NAME);
				if (inviteCode) {
					const membership = await this.acceptInviteForUser(event, identity, inviteCode);
					if (membership) {
						memberships = [membership];
					}
				}

				// 招待受諾失敗 or 招待なし → 新規テナント自動作成
				if (memberships.length === 0) {
					logger.info('[AUTH] First login detected, auto-provisioning', {
						context: { userId: identity.userId, email: identity.email },
					});
					const membership = await this.provisionNewUser(identity);
					if (!membership) return null;
					memberships = [membership];
				}
			}

			const membership = memberships[0];
			if (!membership) return null;

			// テナントステータスを取得
			const tenant = await repos.auth.findTenantById(membership.tenantId);

			// Stripe サブスクリプション状態からライセンスステータスを判定
			const licenseStatus: AuthContext['licenseStatus'] = tenant?.stripeSubscriptionId
				? tenant.status === SUBSCRIPTION_STATUS.ACTIVE ||
					tenant.status === SUBSCRIPTION_STATUS.GRACE_PERIOD
					? AUTH_LICENSE_STATUS.ACTIVE
					: AUTH_LICENSE_STATUS.SUSPENDED
				: AUTH_LICENSE_STATUS.NONE;

			const context: AuthContext = {
				tenantId: membership.tenantId,
				role: membership.role,
				licenseStatus,
				tenantStatus: tenant?.status ?? SUBSCRIPTION_STATUS.ACTIVE,
				plan: tenant?.plan,
			};

			// child ロールの場合、userId から childId を解決 (#0156)
			if (membership.role === 'child') {
				const child = await repos.child.findChildByUserId(identity.userId, membership.tenantId);
				if (child) {
					context.childId = child.id;
				}
			}

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
	 * 招待コードによるテナント参加
	 * AuthUser を確保してから invite-service.acceptInvite を呼ぶ
	 */
	private async acceptInviteForUser(
		event: RequestEvent,
		identity: Extract<Identity, { type: 'cognito' }>,
		inviteCode: string,
	): Promise<import('$lib/server/auth/entities').Membership | null> {
		try {
			// 招待の存在・有効性チェック
			const invite = await getInvite(inviteCode);
			if (!invite) {
				logger.warn('[AUTH] Invite not found or expired', {
					context: { inviteCode },
				});
				this.clearInviteCookie(event);
				return null;
			}

			// AuthUser を確保（Email で既存ユーザーを検索、なければ作成）
			const repos = getRepos();
			const existingUser = await repos.auth.findUserByEmail(identity.email);
			let effectiveUserId: string;
			if (existingUser) {
				effectiveUserId = existingUser.userId;
			} else {
				const user = await repos.auth.createUser({
					email: identity.email,
					provider: 'cognito',
				});
				effectiveUserId = user.userId;
			}

			// 招待受諾
			const result = await acceptInvite(inviteCode, effectiveUserId);

			// Cookie を消費（成功でも失敗でも消す）
			this.clearInviteCookie(event);

			if ('error' in result) {
				logger.warn('[AUTH] Invite acceptance failed', {
					context: { inviteCode, error: result.error, userId: effectiveUserId },
				});
				return null;
			}

			logger.info('[AUTH] User joined tenant via invite', {
				context: {
					userId: effectiveUserId,
					tenantId: result.membership.tenantId,
					role: result.membership.role,
					inviteCode,
				},
			});

			return result.membership;
		} catch (e) {
			logger.error('[AUTH] Failed to accept invite', {
				error: e instanceof Error ? e.message : String(e),
			});
			this.clearInviteCookie(event);
			return null;
		}
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

			// Email で既存ユーザーを検索（Cognito sub と内部 u-xxx ID が異なるため）
			const existingUser = await repos.auth.findUserByEmail(identity.email);

			let effectiveUserId: string;
			if (existingUser) {
				effectiveUserId = existingUser.userId;
			} else {
				// 本当に初回 → AuthUser を作成
				const user = await repos.auth.createUser({
					email: identity.email,
					provider: 'cognito',
				});
				effectiveUserId = user.userId;
			}

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

			// #314: サインアップ時の自動トライアル開始を廃止
			// トライアルはユーザーが管理画面から明示的に開始する

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

	private clearInviteCookie(event: RequestEvent): void {
		event.cookies.delete(INVITE_COOKIE_NAME, { path: '/' });
	}
}
