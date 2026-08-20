// src/lib/server/auth/providers/cognito.ts
// CognitoAuthProvider — Email/Password + MFA + マルチテナント (#0123)

import type { RequestEvent } from '@sveltejs/kit';
import {
	CONTEXT_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
	INVITE_ACCEPT_ERROR_COOKIE_NAME,
	INVITE_ACCEPT_ERROR_MAX_AGE_SECONDS,
	INVITE_COOKIE_NAME,
	isInviteAcceptErrorCode,
} from '$lib/domain/validation/auth';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { acceptInvite, getInvite } from '$lib/server/services/invite-service';
import { authorizeCognito } from '../authorization';
import { getContextMaxAge, signContext, verifyContext } from '../context-token';
import { resolveTenantEntitlement, TenantEntitlementUnavailableError } from '../tenant-entitlement';
import type { AuthContext, AuthProvider, AuthResult, Identity } from '../types';
import { hasMfaAmr, verifyIdentityToken } from './cognito-jwt';
import { refreshCognitoIdToken } from './cognito-oauth';

export class CognitoAuthProvider implements AuthProvider {
	/**
	 * Layer 1: Identity 解決
	 * Cognito JWT（identity_token Cookie）から Identity を取得
	 */
	async resolveIdentity(event: RequestEvent): Promise<Identity | null> {
		const idToken = event.cookies.get(IDENTITY_COOKIE_NAME);

		if (idToken) {
			try {
				const claims = await verifyIdentityToken(idToken);
				if (claims) {
					return {
						type: 'cognito',
						userId: claims.sub,
						email: claims.email,
						// #3555 ③: email 束縛招待の受諾判定 (fail-closed) に使う
						emailVerified: claims.email_verified,
						groups: claims['cognito:groups'],
						// #3025: identities claim の有無で federated (Google 等) を判定
						isFederated: (claims.identities?.length ?? 0) > 0,
						authTime: claims.auth_time,
						// #4266: /ops は ops group + MFA を要求する (hasOpsAccess)
						mfaAuthenticated: hasMfaAmr(claims.amr),
					};
				}
			} catch (e) {
				logger.warn('[AUTH] Identity token verification failed', {
					context: { error: e instanceof Error ? e.message : String(e) },
				});
			}
		}

		// ID Token が期限切れ / 存在しない場合、Refresh Token でサイレントリフレッシュ (#1365)
		try {
			const refreshed = await refreshCognitoIdToken(event.cookies);
			if (refreshed) {
				const claims = await verifyIdentityToken(refreshed.idToken);
				if (claims) {
					return {
						type: 'cognito',
						userId: claims.sub,
						email: claims.email,
						// #3555 ③: email 束縛招待の受諾判定 (fail-closed) に使う
						emailVerified: claims.email_verified,
						groups: claims['cognito:groups'],
						// #3025: identities claim の有無で federated (Google 等) を判定
						isFederated: (claims.identities?.length ?? 0) > 0,
						authTime: claims.auth_time,
						// #4266: /ops は ops group + MFA を要求する (hasOpsAccess)
						mfaAuthenticated: hasMfaAmr(claims.amr),
					};
				}
			}
		} catch (e) {
			logger.warn('[AUTH] Silent refresh failed', {
				context: { error: e instanceof Error ? e.message : String(e) },
			});
		}

		return null;
	}

	/**
	 * Layer 2: Context 解決
	 * context_token Cookie から署名付きトークンをデコードし、課金状態は DB から解決する。
	 * 期限切れの場合はメンバーシップから再発行。
	 *
	 * #3963: token が持つのは tenantId / role / childId のみ。plan / licenseStatus /
	 * tenantStatus を毎リクエスト DB から引くことで、Stripe webhook / 解約 / 再開の
	 * 反映が次のリクエストで即座に効く（従来は Cookie TTL 分＝最大 24h 遅延した）。
	 */
	async resolveContext(
		event: RequestEvent,
		identity: Identity | null,
	): Promise<AuthContext | null> {
		if (!identity) return null;

		// 1. 既存の Context Token を検証
		const contextToken = event.cookies.get(CONTEXT_COOKIE_NAME);
		if (contextToken) {
			const claims = verifyContext(contextToken);
			if (claims) {
				// 課金状態は token を信用せず DB から解決する。解決できなければ
				// `TenantEntitlementUnavailableError` が throw され context は発行されない
				// (fail-closed、握り潰さない)。呼び出し元の hooks.server.ts が 503 に変換する。
				const entitlement = await resolveTenantEntitlement(claims.tenantId);
				return { ...claims, ...entitlement };
			}
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
	 *
	 * #3963: 課金状態の解決失敗 (`TenantEntitlementUnavailableError`) を rethrow する分岐が
	 * 増えたため、メンバーシップ解決を `resolveMembership` に切り出して
	 * cognitive complexity を閾値内に収めた (従来の biome-ignore は不要になった)。
	 */
	private async issueContextFromMembership(
		event: RequestEvent,
		identity: Identity,
	): Promise<AuthContext | null> {
		try {
			if (identity.type !== 'cognito') return null;

			const repos = getRepos();

			const membership = await this.resolveMembership(event, identity);
			if (!membership) return null;

			// テナントの課金状態を取得 (#3963: 解決の SSOT は tenant-entitlement.ts)。
			// DB 障害時は下の catch で握り潰さず rethrow し、hooks が 503 に変換する。
			const context: AuthContext = {
				tenantId: membership.tenantId,
				role: membership.role,
				// #4266: ログイン時点で確定した MFA をセッションに焼き込む。以後 silent refresh で
				// ID token の amr が落ちても、context token が生きている間は /ops に入れる。
				mfaAuthenticated: identity.mfaAuthenticated === true ? true : undefined,
				...(await resolveTenantEntitlement(membership.tenantId)),
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
			// #3963: 課金状態の解決失敗は握り潰さない。null (= 未認証扱い → ログイン画面)
			// にしてしまうと「DB 障害で剥奪」と「正当に無権限」が区別できなくなる。
			if (e instanceof TenantEntitlementUnavailableError) throw e;
			logger.error('[AUTH] Failed to issue context from membership', {
				error: e instanceof Error ? e.message : String(e),
			});
		}

		return null;
	}

	/**
	 * Cognito identity から所属メンバーシップを解決する (1ユーザー=1テナント)。
	 * メンバーシップが無い場合は初回ログインとして招待受諾 → 自動プロビジョニングを試みる。
	 *
	 * #3963: `issueContextFromMembership` から切り出した。挙動は変えていない。
	 */
	private async resolveMembership(
		event: RequestEvent,
		identity: Extract<Identity, { type: 'cognito' }>,
	): Promise<import('$lib/server/auth/entities').Membership | null> {
		const repos = getRepos();

		// Cognito sub → 内部 userId の解決
		// identity.userId は Cognito sub だが、DynamoDB は u-<uuid> で管理
		const existingUser = await repos.auth.findUserByEmail(identity.email);
		const internalUserId = existingUser?.userId ?? identity.userId;

		const memberships = await repos.auth.findUserTenants(internalUserId);
		if (memberships.length > 0) return memberships[0] ?? null;

		// 初回ログイン: 招待コード Cookie があれば招待受諾を試行
		const inviteCode = event.cookies.get(INVITE_COOKIE_NAME);
		if (inviteCode) {
			const membership = await this.acceptInviteForUser(event, identity, inviteCode);
			if (membership) return membership;
		}

		// 招待受諾失敗 or 招待なし → 新規テナント自動作成
		logger.info('[AUTH] First login detected, auto-provisioning', {
			context: { userId: identity.userId, email: identity.email },
		});
		return this.provisionNewUser(identity);
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

			// 招待受諾 (#3555 ③: email 束縛招待は email_verified=false を fail-closed 拒否)
			const result = await acceptInvite(inviteCode, effectiveUserId, identity.email, {
				emailVerified: identity.emailVerified,
			});

			// Cookie を消費（成功でも失敗でも消す）
			this.clearInviteCookie(event);

			if ('error' in result) {
				logger.warn('[AUTH] Invite acceptance failed', {
					context: { inviteCode, error: result.error, userId: effectiveUserId },
				});
				// #3555 ① / #4704: 受諾の拒否は理由を伝えないと dead-end になる (この後 fallback の
				// 新規テナント自動作成が走り、無説明の空 admin に着地する)。1 回限りの通知 cookie を
				// 積み、admin +layout が読み取って案内バナーを表示する。
				//
				// **判定は理由コードの SSOT (`isInviteAcceptErrorCode`) で行う**。旧実装は email 束縛の
				// 2 件だけを allowlist していたため、#4704 で足した `MEMBER_LIMIT_REACHED` が素通りし、
				// 上限で参加できなかった人が黙って別の空グループの owner にされていた。
				if (isInviteAcceptErrorCode(result.error)) {
					event.cookies.set(INVITE_ACCEPT_ERROR_COOKIE_NAME, result.error, {
						path: '/',
						httpOnly: true,
						sameSite: 'lax',
						secure: true,
						maxAge: INVITE_ACCEPT_ERROR_MAX_AGE_SECONDS,
					});
				}
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
			// トライアルはユーザーがご家族の見守り画面から明示的に開始する

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
