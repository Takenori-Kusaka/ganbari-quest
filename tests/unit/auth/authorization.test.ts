import { describe, expect, it } from 'vitest';
import { authorizeCognito } from '../../../src/lib/server/auth/authorization';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

// テスト用ファクトリ
function cognitoIdentity(userId = 'user-1', email = 'test@example.com'): Identity {
	return { type: 'cognito', userId, email };
}

function makeContext(overrides: Partial<AuthContext> = {}): AuthContext {
	return {
		tenantId: 't-test',
		role: 'owner',
		licenseStatus: 'active',
		...overrides,
	};
}

describe('authorizeCognito', () => {
	// ============================================================
	// 公開ルート
	// ============================================================
	describe('公開ルート', () => {
		const publicPaths = [
			'/',
			'/auth/login',
			'/auth/signup',
			'/auth/invite/abc123',
			'/pricing',
			'/setup',
			'/api/health',
			'/api/stripe/webhook',
			'/legal/privacy',
			'/legal/terms',
		];

		for (const path of publicPaths) {
			it(`${path} は未認証でもアクセス可能`, () => {
				const result = authorizeCognito(path, null, null);
				expect(result.allowed).toBe(true);
			});
		}

		it('認証済みで /auth/login → role に応じてリダイレクト（owner → /admin）', () => {
			const result = authorizeCognito(
				'/auth/login',
				cognitoIdentity(),
				makeContext({ role: 'owner' }),
			);
			expect(result.allowed).toBe(false);
			if (!result.allowed) expect(result.redirect).toBe('/admin');
		});

		it('認証済みで /auth/login → role に応じてリダイレクト（child → /switch）', () => {
			const result = authorizeCognito(
				'/auth/login',
				cognitoIdentity(),
				makeContext({ role: 'child' }),
			);
			expect(result.allowed).toBe(false);
			if (!result.allowed) expect(result.redirect).toBe('/switch');
		});
	});

	// ============================================================
	// 未認証アクセス
	// ============================================================
	describe('未認証アクセス', () => {
		const protectedPaths = [
			'/admin',
			'/admin/settings',
			'/admin/license',
			'/admin/members',
			'/kinder/home',
			'/api/v1/activities',
			'/api/v1/admin/license',
		];

		for (const path of protectedPaths) {
			it(`${path} は未認証で /auth/login にリダイレクト`, () => {
				const result = authorizeCognito(path, null, null);
				expect(result.allowed).toBe(false);
				if (!result.allowed) {
					expect(result.redirect).toBe('/auth/login');
				}
			});
		}
	});

	// ============================================================
	// Context なし（テナント未所属）
	// ============================================================
	describe('Context なし（テナント未所属）', () => {
		it('/admin はリダイレクト', () => {
			const result = authorizeCognito('/admin', cognitoIdentity(), null);
			expect(result.allowed).toBe(false);
			if (!result.allowed) expect(result.redirect).toBe('/auth/login');
		});

		it('/onboarding は Context なしでもアクセス可能', () => {
			const result = authorizeCognito('/onboarding', cognitoIdentity(), null);
			expect(result.allowed).toBe(true);
		});

		it('/auth ルートは Context なしでもアクセス可能', () => {
			const result = authorizeCognito('/auth/signup', cognitoIdentity(), null);
			expect(result.allowed).toBe(true);
		});
	});

	// ============================================================
	// ロール別アクセス制御
	// ============================================================
	describe('ロール別アクセス制御', () => {
		describe('owner ロール', () => {
			const ctx = makeContext({ role: 'owner' });
			const id = cognitoIdentity();

			it('/admin にアクセス可能', () => {
				expect(authorizeCognito('/admin', id, ctx).allowed).toBe(true);
			});
			it('/admin/settings にアクセス可能', () => {
				expect(authorizeCognito('/admin/settings', id, ctx).allowed).toBe(true);
			});
			it('/admin/license にアクセス可能', () => {
				expect(authorizeCognito('/admin/license', id, ctx).allowed).toBe(true);
			});
			it('/admin/members にアクセス可能', () => {
				expect(authorizeCognito('/admin/members', id, ctx).allowed).toBe(true);
			});
			it('/child/1 にアクセス可能', () => {
				expect(authorizeCognito('/kinder/home', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/activities にアクセス可能', () => {
				expect(authorizeCognito('/api/v1/activities', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/admin/license にアクセス可能', () => {
				expect(authorizeCognito('/api/v1/admin/license', id, ctx).allowed).toBe(true);
			});
		});

		describe('parent ロール', () => {
			const ctx = makeContext({ role: 'parent' });
			const id = cognitoIdentity();

			it('/admin にアクセス可能', () => {
				expect(authorizeCognito('/admin', id, ctx).allowed).toBe(true);
			});
			it('/admin/license にアクセス可能', () => {
				expect(authorizeCognito('/admin/license', id, ctx).allowed).toBe(true);
			});
			it('/admin/members にアクセス可能', () => {
				expect(authorizeCognito('/admin/members', id, ctx).allowed).toBe(true);
			});
			it('/child/1 にアクセス可能', () => {
				expect(authorizeCognito('/kinder/home', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/activities にアクセス可能', () => {
				expect(authorizeCognito('/api/v1/activities', id, ctx).allowed).toBe(true);
			});
		});

		describe('child ロール', () => {
			const ctx = makeContext({ role: 'child', childId: 1 });
			const id = cognitoIdentity();

			it('/admin にアクセス不可（→ /switch にリダイレクト）', () => {
				const result = authorizeCognito('/admin', id, ctx);
				expect(result.allowed).toBe(false);
				if (!result.allowed) expect(result.redirect).toBe('/switch');
			});
			it('/admin/settings にアクセス不可', () => {
				const result = authorizeCognito('/admin/settings', id, ctx);
				expect(result.allowed).toBe(false);
			});
			it('/admin/license にアクセス不可', () => {
				const result = authorizeCognito('/admin/license', id, ctx);
				expect(result.allowed).toBe(false);
				if (!result.allowed) expect(result.redirect).toBe('/admin');
			});
			it('/admin/members にアクセス不可', () => {
				const result = authorizeCognito('/admin/members', id, ctx);
				expect(result.allowed).toBe(false);
			});
			it('/child/1 にアクセス可能', () => {
				expect(authorizeCognito('/kinder/home', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/activities にアクセス可能', () => {
				expect(authorizeCognito('/api/v1/activities', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/admin/license にアクセス不可', () => {
				const result = authorizeCognito('/api/v1/admin/license', id, ctx);
				expect(result.allowed).toBe(false);
			});
		});
	});

	// ============================================================
	// ライセンス状態チェック
	// ============================================================
	describe('ライセンス状態', () => {
		const id = cognitoIdentity();

		it('active: 全ルートアクセス可能', () => {
			const ctx = makeContext({ licenseStatus: 'active' });
			expect(authorizeCognito('/admin', id, ctx).allowed).toBe(true);
			expect(authorizeCognito('/kinder/home', id, ctx).allowed).toBe(true);
		});

		it('none: 全ルートアクセス可能', () => {
			const ctx = makeContext({ licenseStatus: 'none' });
			expect(authorizeCognito('/admin', id, ctx).allowed).toBe(true);
		});

		it('expired: /admin/license はアクセス可能', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			expect(authorizeCognito('/admin/license', id, ctx).allowed).toBe(true);
		});

		it('expired: /api/stripe はアクセス可能', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			expect(authorizeCognito('/api/stripe/checkout', id, ctx).allowed).toBe(true);
		});

		it('expired: /pricing はアクセス可能（公開ルート）', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			expect(authorizeCognito('/pricing', id, ctx).allowed).toBe(true);
		});

		it('expired: 一般ルートは /admin/license にリダイレクト', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			const result = authorizeCognito('/admin', id, ctx);
			expect(result.allowed).toBe(false);
			if (!result.allowed) expect(result.redirect).toBe('/admin/license?reason=expired');
		});

		it('expired: 子供画面も制限', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			const result = authorizeCognito('/kinder/home', id, ctx);
			expect(result.allowed).toBe(false);
			if (!result.allowed) expect(result.redirect).toBe('/admin/license?reason=expired');
		});

		it('suspended: 全ルートアクセス可能（読み取り専用は API レイヤで制御）', () => {
			const ctx = makeContext({ licenseStatus: 'suspended' });
			expect(authorizeCognito('/admin', id, ctx).allowed).toBe(true);
			expect(authorizeCognito('/kinder/home', id, ctx).allowed).toBe(true);
		});
	});
});
