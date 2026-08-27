// src/lib/server/auth/providers/cognito-dev.ts
// 開発用 CognitoAuthProvider（COGNITO_DEV_MODE=true）
// 実際の AWS Cognito なしでログイン/認可フローをテスト可能にする

import type { RequestEvent } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { CONTEXT_COOKIE_NAME, IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { logger } from '$lib/server/logger';
import { authorizeCognito } from '../authorization';
import { getContextMaxAge, signContext, verifyContext } from '../context-token';
import type { AuthContext, AuthProvider, AuthResult, Identity, Role } from '../types';
import { verifyDevIdentityToken } from './cognito-dev-jwt';
import { hasMfaAmr } from './cognito-jwt';

/**
 * 開発用ダミーユーザー（E2E テストでも使用）
 * ログインフォームでこれらの email/password でログイン可能
 *
 * #776: プラン別ゲート E2E 用に、プラン指定付きの owner ユーザーを追加できるように
 * `licenseStatus` / `plan` を optional フィールドとして持てるようにした。
 * 未指定（従来の owner/parent/child）は `licenseStatus='active'` / `plan=undefined`
 * → `resolvePlanTier` では `standard` と解決される。
 */
export interface DevUser {
	userId: string;
	email: string;
	password: string;
	tenantId: string;
	role: Role;
	/** ライセンス状態（未指定は 'active'） */
	licenseStatus?: AuthContext['licenseStatus'];
	/** Stripe price id 相当（例: 'standard_monthly', 'family_monthly'） */
	plan?: string;
	/** #820: Cognito group 疑似所属。未指定は空扱い */
	groups?: string[];
	/** #3025: federated (Google) 相当。Cognito パスワードを持たないユーザの再現 (PIN reset 分岐検証用) */
	federated?: boolean;
	/** MFA 設定済かどうか。/ops の判定は #4363 で group のみになったが、機構検証のため残す */
	mfa?: boolean;
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
	// ---------- #776: プラン別ゲート E2E 用ユーザー ----------
	// 各ユーザーは tenant を分けておき、データ干渉を防ぐ。
	{
		userId: 'dev-free-owner-001',
		email: 'free@example.com',
		password: 'Gq!Dev#Free2026xy',
		tenantId: 'dev-tenant-free',
		role: 'owner',
		licenseStatus: AUTH_LICENSE_STATUS.NONE,
		plan: undefined,
	},
	{
		userId: 'dev-standard-owner-001',
		email: 'standard@example.com',
		password: 'Gq!Dev#Std2026xyz',
		tenantId: 'dev-tenant-standard',
		role: 'owner',
		licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
		plan: 'standard_monthly',
	},
	{
		userId: 'dev-family-owner-001',
		email: 'family@example.com',
		password: 'Gq!Dev#Fam2026xyz',
		tenantId: 'dev-tenant-family',
		role: 'owner',
		licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
		plan: 'family_monthly',
	},
	// ---------- #752: トライアル E2E 用ユーザー ----------
	// free プランだがトライアル期限切れ済み（global-setup.ts で trial_history をシード）
	{
		userId: 'dev-trial-expired-001',
		email: 'trial-expired@example.com',
		password: 'Gq!Dev#TrialExp26',
		tenantId: 'dev-tenant-trial-expired',
		role: 'owner',
		licenseStatus: AUTH_LICENSE_STATUS.NONE,
		plan: undefined,
	},
	// ---------- #3025: federated (Google OAuth) 相当ユーザー ----------
	// 本番の Google ログインユーザは Cognito パスワードを持たない。dev では login form の
	// password でログインさせるが、発行する JWT に identities claim を載せ federated と同形にする。
	{
		userId: 'dev-google-owner-001',
		email: 'google-owner@example.com',
		password: 'Gq!Dev#Goog2026xy',
		tenantId: 'dev-tenant-google',
		role: 'owner',
		federated: true,
	},
	// ---------- #820 PR-C: /ops 認可 E2E 用ユーザー ----------
	// groups: ['ops'] を付与し、Cognito の ops group 所属として扱う。
	// ops ダッシュボードは単独テナントで閲覧・操作するため、専用 tenant を割り当てる。
	{
		userId: 'dev-ops-001',
		email: 'ops@example.com',
		password: 'Gq!Dev#Ops2026xyz',
		tenantId: 'dev-tenant-ops',
		role: 'owner',
		groups: ['ops'],
		// #4363 で /ops は group のみで通るが、MFA 済の運営者も再現できるよう true にしておく
		// (OPS_MFA_REQUIRED を戻したときの許可経路をローカルで歩けるようにするため)。
		mfa: true,
	},
	// ---------- MFA 未設定の運営者 ----------
	// 現在 (#4363、MFA 要求 off) は /ops に入れる。OPS_MFA_REQUIRED を true に戻すと
	// 403 → 復旧導線 (OpsMfaSetupNotice) に着地する経路の検証に使う。
	// ops group には居るが TOTP 未設定。/ops を開くと 403 + 設定導線 (OpsMfaSetupNotice) に
	// 着地する。この経路を実ブラウザ / E2E で歩けないと「締め出して復旧できない」状態を
	// 作っていないことを確認できないため、dev の SSOT にアカウントを 1 つ用意する
	// (DevCognitoAuthProvider は COGNITO_DEV_MODE=true でのみ使われ、本番には存在しない)。
	{
		userId: 'dev-ops-no-mfa-001',
		email: 'ops-no-mfa@example.com',
		password: 'Gq!Dev#OpsNoMfa26',
		tenantId: 'dev-tenant-ops',
		role: 'owner',
		groups: ['ops'],
		mfa: false,
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
					// #3555 ③: 本番 CognitoAuthProvider と同じ email_verified 伝搬 (dev claim は通常 undefined)
					emailVerified: claims.email_verified,
					groups: claims['cognito:groups'],
					// #3025: 本番 CognitoAuthProvider と同じ federated / recent-auth 情報
					isFederated: (claims.identities?.length ?? 0) > 0,
					authTime: claims.auth_time,
					// #4266: 本番 CognitoAuthProvider と同じ MFA 判定 (amr claim)
					mfaAuthenticated: hasMfaAmr(claims.amr),
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

		// 既存 Context Token を検証。
		// #3963: token は tenantId / role / childId しか持たない。dev では plan /
		// licenseStatus の SSOT が devUsers 定義なので、毎回そこから解決し直す
		// (本番 CognitoAuthProvider が毎回 DB から解決するのと同じ扱い)。
		const contextToken = event.cookies.get(CONTEXT_COOKIE_NAME);
		if (contextToken && identity.type === 'cognito') {
			const claims = verifyContext(contextToken);
			const devUser = claims ? findDevUser(identity.email) : undefined;
			// #4643: userId を持たない旧 token は採用せず発行し直す (本番 provider と同じ扱い)
			if (claims?.userId && devUser) {
				return {
					...claims,
					licenseStatus: devUser.licenseStatus ?? AUTH_LICENSE_STATUS.ACTIVE,
					tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
					plan: devUser.plan,
				};
			}
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

		// #776: dev user のプラン情報を反映する。未指定時は従来通り active/standard 扱い。
		const context: AuthContext = {
			tenantId: devUser.tenantId,
			role: devUser.role,
			// #4643: dev では DEV_USERS の userId がアプリ側 user id を兼ねる (SSOT は DEV_USERS)
			userId: devUser.userId,
			licenseStatus: devUser.licenseStatus ?? AUTH_LICENSE_STATUS.ACTIVE,
			tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
			plan: devUser.plan,
			// #4266: 本番 CognitoAuthProvider と同じくセッションに MFA を焼き込む
			mfaAuthenticated: identity.mfaAuthenticated === true ? true : undefined,
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
