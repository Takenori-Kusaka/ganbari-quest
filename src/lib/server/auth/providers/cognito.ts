// src/lib/server/auth/providers/cognito.ts
// CognitoAuthProvider — Email/Password + MFA + マルチテナント (#0123)

import type { RequestEvent } from '@sveltejs/kit';
import {
	CONTEXT_COOKIE_NAME,
	IDENTITY_COOKIE_NAME,
	INVITE_COOKIE_NAME,
} from '$lib/domain/validation/auth';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { acceptInvite } from '$lib/server/services/invite-service';
import { authorizeCognito } from '../authorization';
import { getContextMaxAge, signContext, verifyContext } from '../context-token';
import { ensureAuthUser, provisionOwnTenant } from '../provisioning';
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
			// #4643: userId (アプリ DB の users.user_id) を持たない旧 token は採用しない。
			// 採用すると所有者判定が undefined 起点になり、静かに空振りする経路が残る。
			// membership から発行し直せば 1 リクエストで新形式に移行する。
			if (claims?.userId) {
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
				// #4643: アプリ DB の users.user_id。IdP の sub (identity.userId) は入れない
				userId: membership.userId,
				// #4266: ログイン時点で確定した MFA をセッションに焼き込む。以後 silent refresh で
				// ID token の amr が落ちても、context token が生きている間は /ops に入れる。
				mfaAuthenticated: identity.mfaAuthenticated === true ? true : undefined,
				...(await resolveTenantEntitlement(membership.tenantId)),
			};

			// child ロールの場合、userId から childId を解決 (#0156)
			// #4643: children.user_id はアプリ DB の users.user_id を指す。identity.userId (sub) で
			// 引くと必ず 0 件になり、招待で参加した子供の childId が永久に解決されなかった。
			if (membership.role === 'child') {
				const child = await repos.child.findChildByUserId(membership.userId, membership.tenantId);
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
	 *
	 * #4636: 招待 Cookie を持つ人の受諾が失敗した場合は **null を返して止める**。
	 * 旧実装はここで `provisionNewUser` にフォールバックしていたため、招待された人が
	 * 「別世帯の owner」として空の管理画面に着地していた (PO 報告の実害 2 件)。
	 * membership 未確定は異常ではなく正規の状態として扱い (`/auth/join`)、世帯を作るかどうかは
	 * 顧客自身に選ばせる。招待を持たない通常のサインアップは従来どおり自動作成する。
	 */
	private async resolveMembership(
		event: RequestEvent,
		identity: Extract<Identity, { type: 'cognito' }>,
	): Promise<import('$lib/server/auth/entities').Membership | null> {
		const repos = getRepos();

		// #4643: IdP の sub (identity.userId) は users.user_id ではない。email が両者の唯一の橋で、
		// users は email_lower UNIQUE のため 1 メール = 1 行 (通常ログインと Google 連携は
		// Cognito 上で別 sub でも、アプリ上は同じ人として同じ行に解決される)。
		// users 行が無ければ memberships (user_id 外部参照) も原理的に存在しないため、
		// sub で findUserTenants を撃たない (存在しない id での空振りクエリを作らない)。
		const existingUser = await repos.auth.findUserByEmail(identity.email);
		const memberships = existingUser ? await repos.auth.findUserTenants(existingUser.userId) : [];
		if (memberships.length > 0) return memberships[0] ?? null;

		// 初回ログイン: 招待コード Cookie があれば招待受諾を試行
		const inviteCode = event.cookies.get(INVITE_COOKIE_NAME);
		if (inviteCode) {
			// #4636: 失敗しても新規世帯は作らない。招待 Cookie は残したままにして
			// (a) `/auth/join` が理由を再導出でき、(b) 原因 (メール未確認など) が解消されたら
			// 次のリクエストで自動的に合流できるようにする。
			return this.acceptInviteForUser(event, identity, inviteCode);
		}

		// 招待なしの初回ログイン (通常のサインアップ) → 新規テナント自動作成
		logger.info('[AUTH] First login detected, auto-provisioning', {
			context: { userId: identity.userId, email: identity.email },
		});
		return provisionOwnTenant(identity.email);
	}

	/**
	 * 招待コードによるテナント参加。
	 * AuthUser を確保してから invite-service.acceptInvite を呼ぶ。
	 *
	 * #4636: 失敗しても新規テナントは作らず null を返す (呼び出し元が context 未発行のまま
	 * `/auth/join` に留める)。招待 Cookie は成功時のみ消費し、失敗時は残す —
	 * 理由の再導出 (`/auth/join` が `previewInviteAcceptance` で引き直す) と、
	 * メール確認などの原因が解消されたときの自動合流のため。
	 */
	private async acceptInviteForUser(
		event: RequestEvent,
		identity: Extract<Identity, { type: 'cognito' }>,
		inviteCode: string,
	): Promise<import('$lib/server/auth/entities').Membership | null> {
		try {
			// AuthUser を確保（Email で既存ユーザーを検索、なければ作成）
			const effectiveUserId = await ensureAuthUser(identity.email);

			// 招待受諾 (#3555 ③: email 束縛招待は email_verified=false を fail-closed 拒否)。
			// 招待の存在・有効性・期限は acceptInvite 内の getInvite が判定し
			// INVALID_OR_EXPIRED を返すため、ここで二重に引かない。
			const result = await acceptInvite(inviteCode, effectiveUserId, identity.email, {
				emailVerified: identity.emailVerified,
			});

			if ('error' in result) {
				logger.warn('[AUTH] Invite acceptance failed (membership stays undecided)', {
					context: { inviteCode, error: result.error, userId: effectiveUserId },
				});
				return null;
			}

			// 成功時のみ Cookie を消費 (#0203: 共有端末での取り違え参加を物理排除する)
			this.clearInviteCookie(event);

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
