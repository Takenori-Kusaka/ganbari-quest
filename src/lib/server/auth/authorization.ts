// src/lib/server/auth/authorization.ts
// ロール × ルート 認可マトリクス (#0123: viewer廃止, device廃止)

import type { AuthContext, AuthResult, Identity, Role } from './types';

interface RouteRule {
	pattern: string;
	/** 許可するロール。空配列 = 認証不要 */
	roles: Role[];
	/** owner 限定ルート */
	ownerOnly?: boolean;
	/** 未認証時のリダイレクト先 */
	unauthRedirect?: string;
	/** ロール不足時のリダイレクト先 */
	forbiddenRedirect?: string;
}

/**
 * ルート保護ルール（上から順にマッチング、最初に一致したルールを適用）
 * #0123 チケットの認可マトリクスに基づく
 */
const ROUTE_RULES: RouteRule[] = [
	// ライセンス管理 — owner + parent
	{
		pattern: '/admin/license',
		roles: ['owner', 'parent'],
		unauthRedirect: '/auth/login',
		forbiddenRedirect: '/admin',
	},
	// メンバー管理 — owner + parent
	{
		pattern: '/admin/members',
		roles: ['owner', 'parent'],
		unauthRedirect: '/auth/login',
		forbiddenRedirect: '/admin',
	},
	// 管理画面全般 — owner + parent
	{
		pattern: '/admin',
		roles: ['owner', 'parent'],
		unauthRedirect: '/auth/login',
		forbiddenRedirect: '/child',
	},
	// 子供画面 — 全ロール
	{
		pattern: '/child',
		roles: ['owner', 'parent', 'child'],
		unauthRedirect: '/auth/login',
	},
	// 管理 API — owner + parent
	{
		pattern: '/api/v1/admin',
		roles: ['owner', 'parent'],
	},
	// 子供 API — 全ロール
	{
		pattern: '/api/v1',
		roles: ['owner', 'parent', 'child'],
	},
];

/**
 * Cognito モード用認可チェック
 * ルート × ロール × ライセンス状態を検証する
 */
export function authorizeCognito(
	path: string,
	identity: Identity | null,
	context: AuthContext | null,
): AuthResult {
	// 公開ルート（認証不要）
	if (isPublicRoute(path)) {
		// 認証済みで /auth/login にアクセスしたら適切な画面へ
		if (path.startsWith('/auth/login') && identity && context) {
			const redirect = context.role === 'child' ? '/child' : '/admin';
			return { allowed: false, redirect };
		}
		return { allowed: true };
	}

	// 認証チェック
	if (!identity) {
		const rule = findMatchingRule(path);
		return { allowed: false, redirect: rule?.unauthRedirect ?? '/auth/login', status: 401 };
	}

	// Context がない場合（テナント未所属）
	if (!context) {
		// オンボーディング系ルートは Context なしでもアクセス可能
		if (path.startsWith('/onboarding') || path.startsWith('/auth')) {
			return { allowed: true };
		}
		return { allowed: false, redirect: '/auth/login' };
	}

	// ライセンス状態チェック
	const licenseResult = checkLicenseAccess(path, context);
	if (!licenseResult.allowed) return licenseResult;

	// ルール検索
	const rule = findMatchingRule(path);
	if (!rule) return { allowed: true };

	// ロールチェック
	if (rule.roles.length > 0 && !rule.roles.includes(context.role)) {
		return {
			allowed: false,
			redirect: rule.forbiddenRedirect ?? '/child',
			status: 403,
		};
	}

	return { allowed: true };
}

function findMatchingRule(path: string): RouteRule | undefined {
	return ROUTE_RULES.find((rule) => path.startsWith(rule.pattern));
}

function isPublicRoute(path: string): boolean {
	return (
		path === '/' ||
		path.startsWith('/auth') ||
		path.startsWith('/pricing') ||
		path.startsWith('/switch') ||
		path.startsWith('/setup') ||
		path.startsWith('/_app') ||
		path.startsWith('/favicon') ||
		path.startsWith('/api/health')
	);
}

function checkLicenseAccess(path: string, context: AuthContext): AuthResult {
	const { licenseStatus } = context;

	if (licenseStatus === 'active' || licenseStatus === 'none') {
		return { allowed: true };
	}

	if (licenseStatus === 'expired') {
		// ライセンス管理ページは期限切れでもアクセス可能（更新促進）
		if (path.startsWith('/admin/license') || path.startsWith('/api/v1/admin/license')) {
			return { allowed: true };
		}
		return { allowed: false, redirect: '/admin/license?reason=expired' };
	}

	if (licenseStatus === 'suspended') {
		// suspended = 読み取り専用。GET は許可、POST/PUT/DELETE は API レイヤで制御
		return { allowed: true };
	}

	return { allowed: true };
}
