// tests/unit/services/authorization.test.ts
// 認可マトリクスのユニットテスト

import { describe, expect, it } from 'vitest';
import { authorizeCognito } from '../../../src/lib/server/auth/authorization';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

const oauthIdentity: Identity = { type: 'oauth', userId: 'u-123', email: 'parent@example.com' };
const deviceIdentity: Identity = { type: 'device', deviceId: 'd-456', tenantId: 't-789' };

const ownerContext: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'active' };
const parentContext: AuthContext = { tenantId: 't-1', role: 'parent', licenseStatus: 'active' };
const childContext: AuthContext = {
	tenantId: 't-1',
	role: 'child',
	childId: 1,
	licenseStatus: 'active',
};
const viewerContext: AuthContext = { tenantId: 't-1', role: 'viewer', licenseStatus: 'active' };

describe('authorizeCognito', () => {
	describe('公開ルート', () => {
		it('/ は未認証でもアクセス可能', () => {
			expect(authorizeCognito('/', null, null)).toEqual({ allowed: true });
		});

		it('/login は未認証でもアクセス可能', () => {
			expect(authorizeCognito('/login', null, null)).toEqual({ allowed: true });
		});

		it('/api/health は未認証でもアクセス可能', () => {
			expect(authorizeCognito('/api/health', null, null)).toEqual({ allowed: true });
		});

		it('認証済み owner が /login にアクセス → /admin リダイレクト', () => {
			const result = authorizeCognito('/login', oauthIdentity, ownerContext);
			expect(result).toEqual({ allowed: false, redirect: '/admin' });
		});

		it('認証済み child が /login にアクセス → /child リダイレクト', () => {
			const result = authorizeCognito('/login', oauthIdentity, childContext);
			expect(result).toEqual({ allowed: false, redirect: '/child' });
		});
	});

	describe('/admin ルート — owner/parent のみ', () => {
		it('owner はアクセス可能', () => {
			expect(authorizeCognito('/admin', oauthIdentity, ownerContext)).toEqual({ allowed: true });
		});

		it('parent はアクセス可能', () => {
			expect(authorizeCognito('/admin', oauthIdentity, parentContext)).toEqual({ allowed: true });
		});

		it('child は /child/switch にリダイレクト', () => {
			const result = authorizeCognito('/admin', oauthIdentity, childContext);
			expect(result).toEqual({ allowed: false, redirect: '/child/switch', status: 403 });
		});

		it('viewer は /child/switch にリダイレクト', () => {
			const result = authorizeCognito('/admin', oauthIdentity, viewerContext);
			expect(result).toEqual({ allowed: false, redirect: '/child/switch', status: 403 });
		});

		it('未認証は /login にリダイレクト', () => {
			const result = authorizeCognito('/admin', null, null);
			expect(result).toEqual({ allowed: false, redirect: '/login', status: 401 });
		});

		it('デバイストークンでは /child/switch にリダイレクト', () => {
			const deviceCtx: AuthContext = { tenantId: 't-1', role: 'child', licenseStatus: 'active' };
			const result = authorizeCognito('/admin', deviceIdentity, deviceCtx);
			expect(result).toEqual({ allowed: false, redirect: '/child/switch', status: 403 });
		});
	});

	describe('/admin/billing — owner のみ', () => {
		it('owner はアクセス可能', () => {
			expect(authorizeCognito('/admin/billing', oauthIdentity, ownerContext)).toEqual({
				allowed: true,
			});
		});

		it('parent は /admin にリダイレクト', () => {
			const result = authorizeCognito('/admin/billing', oauthIdentity, parentContext);
			expect(result).toEqual({ allowed: false, redirect: '/admin', status: 403 });
		});
	});

	describe('/child ルート — 全ロール + デバイス', () => {
		it('child はアクセス可能', () => {
			expect(authorizeCognito('/child', oauthIdentity, childContext)).toEqual({ allowed: true });
		});

		it('viewer はアクセス可能', () => {
			expect(authorizeCognito('/child', oauthIdentity, viewerContext)).toEqual({ allowed: true });
		});

		it('デバイストークンでアクセス可能', () => {
			const deviceCtx: AuthContext = { tenantId: 't-1', role: 'child', licenseStatus: 'active' };
			expect(authorizeCognito('/child', deviceIdentity, deviceCtx)).toEqual({ allowed: true });
		});

		it('owner もアクセス可能', () => {
			expect(authorizeCognito('/child', oauthIdentity, ownerContext)).toEqual({ allowed: true });
		});
	});

	describe('API ルート', () => {
		it('/api/v1/admin — owner アクセス可能', () => {
			expect(authorizeCognito('/api/v1/admin/children', oauthIdentity, ownerContext)).toEqual({
				allowed: true,
			});
		});

		it('/api/v1/admin — child は 403', () => {
			const result = authorizeCognito('/api/v1/admin/children', oauthIdentity, childContext);
			expect(result).toEqual({ allowed: false, redirect: '/child', status: 403 });
		});

		it('/api/v1/activities — child アクセス可能', () => {
			expect(authorizeCognito('/api/v1/activities', oauthIdentity, childContext)).toEqual({
				allowed: true,
			});
		});

		it('/api/v1/billing — owner のみ', () => {
			expect(authorizeCognito('/api/v1/billing', oauthIdentity, ownerContext)).toEqual({
				allowed: true,
			});
		});

		it('/api/v1/billing — parent は 403', () => {
			const result = authorizeCognito('/api/v1/billing', oauthIdentity, parentContext);
			expect(result).toEqual({ allowed: false, redirect: '/child', status: 403 });
		});
	});

	describe('ライセンス状態', () => {
		it('expired → /admin/billing にリダイレクト', () => {
			const expired: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'expired' };
			const result = authorizeCognito('/admin', oauthIdentity, expired);
			expect(result).toEqual({ allowed: false, redirect: '/admin/billing?reason=expired' });
		});

		it('expired でも /admin/billing はアクセス可能', () => {
			const expired: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'expired' };
			expect(authorizeCognito('/admin/billing', oauthIdentity, expired)).toEqual({ allowed: true });
		});

		it('suspended は表示系はアクセス可能', () => {
			const suspended: AuthContext = { tenantId: 't-1', role: 'owner', licenseStatus: 'suspended' };
			expect(authorizeCognito('/admin', oauthIdentity, suspended)).toEqual({ allowed: true });
		});
	});

	describe('Context なし（テナント未選択）', () => {
		it('認証済みだが Context なし → /auth/select-tenant へ', () => {
			const result = authorizeCognito('/admin', oauthIdentity, null);
			expect(result).toEqual({ allowed: false, redirect: '/auth/select-tenant' });
		});

		it('/onboarding は Context なしでもアクセス可能', () => {
			expect(authorizeCognito('/onboarding/license', oauthIdentity, null)).toEqual({
				allowed: true,
			});
		});

		it('/auth ルートは Context なしでもアクセス可能', () => {
			expect(authorizeCognito('/auth/callback', oauthIdentity, null)).toEqual({ allowed: true });
		});
	});
});
