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
			'/admin/subscription',
			'/admin/members',
			'/preschool/home',
			'/api/v1/activities',
			'/api/v1/admin/downgrade-preview',
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
			it('/admin/subscription にアクセス可能', () => {
				expect(authorizeCognito('/admin/subscription', id, ctx).allowed).toBe(true);
			});
			it('/admin/members にアクセス可能', () => {
				expect(authorizeCognito('/admin/members', id, ctx).allowed).toBe(true);
			});
			it('/child/1 にアクセス可能', () => {
				expect(authorizeCognito('/preschool/home', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/activities にアクセス可能', () => {
				expect(authorizeCognito('/api/v1/activities', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/admin/downgrade-preview にアクセス可能', () => {
				expect(authorizeCognito('/api/v1/admin/downgrade-preview', id, ctx).allowed).toBe(true);
			});
		});

		describe('parent ロール', () => {
			const ctx = makeContext({ role: 'parent' });
			const id = cognitoIdentity();

			it('/admin にアクセス可能', () => {
				expect(authorizeCognito('/admin', id, ctx).allowed).toBe(true);
			});
			it('/admin/subscription にアクセス可能', () => {
				expect(authorizeCognito('/admin/subscription', id, ctx).allowed).toBe(true);
			});
			it('/admin/members にアクセス可能', () => {
				expect(authorizeCognito('/admin/members', id, ctx).allowed).toBe(true);
			});
			it('/child/1 にアクセス可能', () => {
				expect(authorizeCognito('/preschool/home', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/activities にアクセス可能', () => {
				expect(authorizeCognito('/api/v1/activities', id, ctx).allowed).toBe(true);
			});
		});

		describe('child ロール', () => {
			const ctx = makeContext({ role: 'child', childId: 1 });
			const id = cognitoIdentity();

			it('/admin にアクセス不可（→ /switch?reason=admin_forbidden にリダイレクト）', () => {
				const result = authorizeCognito('/admin', id, ctx);
				expect(result.allowed).toBe(false);
				if (!result.allowed) expect(result.redirect).toBe('/switch?reason=admin_forbidden');
			});
			it('/admin/settings にアクセス不可', () => {
				const result = authorizeCognito('/admin/settings', id, ctx);
				expect(result.allowed).toBe(false);
			});
			it('/admin/subscription にアクセス不可', () => {
				const result = authorizeCognito('/admin/subscription', id, ctx);
				expect(result.allowed).toBe(false);
				if (!result.allowed) expect(result.redirect).toBe('/admin');
			});
			it('/admin/members にアクセス不可', () => {
				const result = authorizeCognito('/admin/members', id, ctx);
				expect(result.allowed).toBe(false);
			});
			it('/child/1 にアクセス可能', () => {
				expect(authorizeCognito('/preschool/home', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/activities にアクセス可能', () => {
				expect(authorizeCognito('/api/v1/activities', id, ctx).allowed).toBe(true);
			});
			it('/api/v1/admin/downgrade-preview にアクセス不可', () => {
				const result = authorizeCognito('/api/v1/admin/downgrade-preview', id, ctx);
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
			expect(authorizeCognito('/preschool/home', id, ctx).allowed).toBe(true);
		});

		it('none: 全ルートアクセス可能', () => {
			const ctx = makeContext({ licenseStatus: 'none' });
			expect(authorizeCognito('/admin', id, ctx).allowed).toBe(true);
		});

		it('expired: /admin/subscription はアクセス可能', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			expect(authorizeCognito('/admin/subscription', id, ctx).allowed).toBe(true);
		});

		it('expired: /api/stripe はアクセス可能', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			expect(authorizeCognito('/api/stripe/checkout', id, ctx).allowed).toBe(true);
		});

		it('expired: /pricing はアクセス可能（公開ルート）', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			expect(authorizeCognito('/pricing', id, ctx).allowed).toBe(true);
		});

		it('expired: 一般ルートは /admin/subscription にリダイレクト', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			const result = authorizeCognito('/admin', id, ctx);
			expect(result.allowed).toBe(false);
			if (!result.allowed) expect(result.redirect).toBe('/admin/subscription?reason=expired');
		});

		it('expired: 子供画面も制限', () => {
			const ctx = makeContext({ licenseStatus: 'expired' });
			const result = authorizeCognito('/preschool/home', id, ctx);
			expect(result.allowed).toBe(false);
			if (!result.allowed) expect(result.redirect).toBe('/admin/subscription?reason=expired');
		});

		it('suspended: 全ルートアクセス可能（読み取り専用は API レイヤで制御）', () => {
			const ctx = makeContext({ licenseStatus: 'suspended' });
			expect(authorizeCognito('/admin', id, ctx).allowed).toBe(true);
			expect(authorizeCognito('/preschool/home', id, ctx).allowed).toBe(true);
		});
	});

	// ============================================================
	// #3133: 静的ファイル配信ルートの認証必須化（default-allow 禁止）
	// ============================================================
	describe('静的ファイル配信ルート (#3133 cross-tenant IDOR)', () => {
		const id = cognitoIdentity();

		it('/tenants/* は未認証で 401（default-allow に落ちない）', () => {
			const result = authorizeCognito('/tenants/t-other/avatars/1/x.png', null, null);
			expect(result.allowed).toBe(false);
			if (!result.allowed) expect(result.status).toBe(401);
		});

		it('/uploads/avatars/* は未認証で 401（default-allow に落ちない）', () => {
			const result = authorizeCognito('/uploads/avatars/avatar-1-x.png', null, null);
			expect(result.allowed).toBe(false);
			if (!result.allowed) expect(result.status).toBe(401);
		});

		it('/tenants/* は認証済の全ロールで allowed（tenant 一致検証はハンドラ層）', () => {
			for (const role of ['owner', 'parent', 'child'] as const) {
				const ctx = makeContext({ role });
				expect(authorizeCognito('/tenants/t-test/avatars/1/x.png', id, ctx).allowed).toBe(true);
			}
		});

		it('/uploads/avatars/* は認証済の全ロールで allowed（tenant 一致検証はハンドラ層）', () => {
			for (const role of ['owner', 'parent', 'child'] as const) {
				const ctx = makeContext({ role });
				expect(authorizeCognito('/uploads/avatars/avatar-1-x.png', id, ctx).allowed).toBe(true);
			}
		});
	});
});
