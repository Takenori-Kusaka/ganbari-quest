// src/lib/server/auth/providers/cognito-dev.ts
// 開発用 CognitoAuthProvider（COGNITO_DEV_MODE=true）
// 実際の AWS Cognito なしでログイン/認可フローをテスト可能にする

import type { RequestEvent } from '@sveltejs/kit';
import { CONTEXT_COOKIE_NAME, IDENTITY_COOKIE_NAME } from '$lib/domain/validation/auth';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { logger } from '$lib/server/logger';
import { authorizeCognito } from '../authorization';
import { getContextMaxAge, signContext, verifyContext } from '../context-token';
import type { AuthContext, AuthProvider, AuthResult, Identity, Role } from '../types';
import { verifyDevIdentityToken } from './cognito-dev-jwt';

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
		licenseStatus: 'none',
		plan: undefined,
	},
	{
		userId: 'dev-standard-owner-001',
		email: 'standard@example.com',
		password: 'Gq!Dev#Std2026xyz',
		tenantId: 'dev-tenant-standard',
		role: 'owner',
		licenseStatus: 'active',
		plan: 'standard_monthly',
	},
	{
		userId: 'dev-family-owner-001',
		email: 'family@example.com',
		password: 'Gq!Dev#Fam2026xyz',
		tenantId: 'dev-tenant-family',
		role: 'owner',
		licenseStatus: 'active',
		plan: 'family_monthly',
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

		// #776: dev user のプラン情報を反映する。未指定時は従来通り active/standard 扱い。
		const context: AuthContext = {
			tenantId: devUser.tenantId,
			role: devUser.role,
			licenseStatus: devUser.licenseStatus ?? 'active',
			tenantStatus: 'active',
			plan: devUser.plan,
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
