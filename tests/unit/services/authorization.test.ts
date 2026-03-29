// tests/unit/services/authorization.test.ts
// 認可マトリクスのユニットテスト (#0123: viewer廃止, device廃止)

import { describe, expect, it } from 'vitest';
import { authorizeCognito } from '../../../src/lib/server/auth/authorization';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

const cognitoIdentity: Identity = {
	type: 'cognito',
	userId: 'u-123',
	email: 'parent@example.com',
};

const ownerContext: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'active' };
const parentContext: AuthContext = { tenantId: 't-1', role: 'parent', licenseStatus: 'active' };
const childContext: AuthContext = {
	tenantId: 't-1',
	role: 'child',
	childId: 1,
	licenseStatus: 'active',
};

describe('authorizeCognito', () => {
	describe('公開ルート', () => {
		it('/ は未認証でもアクセス可能', () => {
			expect(authorizeCognito('/', null, null)).toEqual({ allowed: true });
		});

		it('/auth/login は未認証でもアクセス可能', () => {
			expect(authorizeCognito('/auth/login', null, null)).toEqual({ allowed: true });
		});

		it('/api/health は未認証でもアクセス可能', () => {
			expect(authorizeCognito('/api/health', null, null)).toEqual({ allowed: true });
		});

		it('/pricing は未認証でもアクセス可能', () => {
			expect(authorizeCognito('/pricing', null, null)).toEqual({ allowed: true });
		});

		it('/switch は未認証だとログインにリダイレクト', () => {
			const result = authorizeCognito('/switch', null, null);
			expect(result).toEqual({ allowed: false, redirect: '/auth/login', status: 401 });
		});

		it('認証済み owner が /auth/login にアクセス → /admin リダイレクト', () => {
			const result = authorizeCognito('/auth/login', cognitoIdentity, ownerContext);
			expect(result).toEqual({ allowed: false, redirect: '/admin' });
		});

		it('認証済み child が /auth/login にアクセス → /switch リダイレクト', () => {
			const result = authorizeCognito('/auth/login', cognitoIdentity, childContext);
			expect(result).toEqual({ allowed: false, redirect: '/switch' });
		});
	});

	describe('/admin ルート — owner/parent のみ', () => {
		it('owner はアクセス可能', () => {
			expect(authorizeCognito('/admin', cognitoIdentity, ownerContext)).toEqual({
				allowed: true,
			});
		});

		it('parent はアクセス可能', () => {
			expect(authorizeCognito('/admin', cognitoIdentity, parentContext)).toEqual({
				allowed: true,
			});
		});

		it('child は /switch にリダイレクト', () => {
			const result = authorizeCognito('/admin', cognitoIdentity, childContext);
			expect(result).toEqual({ allowed: false, redirect: '/switch', status: 403 });
		});

		it('未認証は /auth/login にリダイレクト', () => {
			const result = authorizeCognito('/admin', null, null);
			expect(result).toEqual({ allowed: false, redirect: '/auth/login', status: 401 });
		});
	});

	describe('/admin/license — owner + parent', () => {
		it('owner はアクセス可能', () => {
			expect(authorizeCognito('/admin/license', cognitoIdentity, ownerContext)).toEqual({
				allowed: true,
			});
		});

		it('parent はアクセス可能', () => {
			expect(authorizeCognito('/admin/license', cognitoIdentity, parentContext)).toEqual({
				allowed: true,
			});
		});

		it('child は /admin にリダイレクト', () => {
			const result = authorizeCognito('/admin/license', cognitoIdentity, childContext);
			expect(result).toEqual({ allowed: false, redirect: '/admin', status: 403 });
		});
	});

	describe('/kinder ルート — 全ロール', () => {
		it('child はアクセス可能', () => {
			expect(authorizeCognito('/kinder/home', cognitoIdentity, childContext)).toEqual({
				allowed: true,
			});
		});

		it('owner もアクセス可能', () => {
			expect(authorizeCognito('/kinder/home', cognitoIdentity, ownerContext)).toEqual({
				allowed: true,
			});
		});

		it('parent もアクセス可能', () => {
			expect(authorizeCognito('/kinder/home', cognitoIdentity, parentContext)).toEqual({
				allowed: true,
			});
		});
	});

	describe('API ルート', () => {
		it('/api/v1/admin — owner アクセス可能', () => {
			expect(authorizeCognito('/api/v1/admin/children', cognitoIdentity, ownerContext)).toEqual({
				allowed: true,
			});
		});

		it('/api/v1/admin — child は 403', () => {
			const result = authorizeCognito('/api/v1/admin/children', cognitoIdentity, childContext);
			expect(result).toEqual({ allowed: false, redirect: '/switch', status: 403 });
		});

		it('/api/v1/activities — child アクセス可能', () => {
			expect(authorizeCognito('/api/v1/activities', cognitoIdentity, childContext)).toEqual({
				allowed: true,
			});
		});
	});

	describe('ライセンス状態', () => {
		it('expired → /admin/license にリダイレクト', () => {
			const expired: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'expired' };
			const result = authorizeCognito('/admin', cognitoIdentity, expired);
			expect(result).toEqual({
				allowed: false,
				redirect: '/admin/license?reason=expired',
			});
		});

		it('expired でも /admin/license はアクセス可能', () => {
			const expired: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'expired' };
			expect(authorizeCognito('/admin/license', cognitoIdentity, expired)).toEqual({
				allowed: true,
			});
		});

		it('suspended は表示系はアクセス可能', () => {
			const suspended: AuthContext = {
				tenantId: 't-1',
				role: 'owner',
				licenseStatus: 'suspended',
			};
			expect(authorizeCognito('/admin', cognitoIdentity, suspended)).toEqual({ allowed: true });
		});
	});

	describe('Context なし（テナント未所属）', () => {
		it('認証済みだが Context なし → /auth/login へ', () => {
			const result = authorizeCognito('/admin', cognitoIdentity, null);
			expect(result).toEqual({ allowed: false, redirect: '/auth/login' });
		});

		it('/onboarding は Context なしでもアクセス可能', () => {
			expect(authorizeCognito('/onboarding/license', cognitoIdentity, null)).toEqual({
				allowed: true,
			});
		});

		it('/auth ルートは Context なしでもアクセス可能', () => {
			expect(authorizeCognito('/auth/callback', cognitoIdentity, null)).toEqual({
				allowed: true,
			});
		});
	});
});
