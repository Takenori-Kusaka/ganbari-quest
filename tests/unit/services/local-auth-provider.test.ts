// tests/unit/services/local-auth-provider.test.ts
// LocalAuthProvider の authorize() ロジックテスト

import { describe, expect, it } from 'vitest';
import { LocalAuthProvider } from '../../../src/lib/server/auth/providers/local';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

const provider = new LocalAuthProvider();

const pinIdentity: Identity = { type: 'pin', sessionId: 'test-session-id' };
const localContext: AuthContext = {
	tenantId: 'local',
	role: 'owner',
	licenseStatus: 'none',
};

describe('LocalAuthProvider.authorize', () => {
	describe('未認証ユーザー', () => {
		it('/admin は /login にリダイレクト', () => {
			const result = provider.authorize('/admin', null, null);
			expect(result).toEqual({ allowed: false, redirect: '/login' });
		});

		it('/admin/children は /login にリダイレクト', () => {
			const result = provider.authorize('/admin/children', null, null);
			expect(result).toEqual({ allowed: false, redirect: '/login' });
		});

		it('/admin/settings は /login にリダイレクト', () => {
			const result = provider.authorize('/admin/settings', null, null);
			expect(result).toEqual({ allowed: false, redirect: '/login' });
		});

		it('/ はアクセス可能', () => {
			const result = provider.authorize('/', null, null);
			expect(result).toEqual({ allowed: true });
		});

		it('/login はアクセス可能', () => {
			const result = provider.authorize('/login', null, null);
			expect(result).toEqual({ allowed: true });
		});

		it('/baby はアクセス可能（子供画面は認証不要）', () => {
			const result = provider.authorize('/baby', null, null);
			expect(result).toEqual({ allowed: true });
		});

		it('/kinder はアクセス可能', () => {
			const result = provider.authorize('/kinder', null, null);
			expect(result).toEqual({ allowed: true });
		});

		it('/api/v1/activities はアクセス可能', () => {
			const result = provider.authorize('/api/v1/activities', null, null);
			expect(result).toEqual({ allowed: true });
		});

		it('/api/health はアクセス可能', () => {
			const result = provider.authorize('/api/health', null, null);
			expect(result).toEqual({ allowed: true });
		});

		it('/setup はアクセス可能', () => {
			const result = provider.authorize('/setup', null, null);
			expect(result).toEqual({ allowed: true });
		});
	});

	describe('認証済みユーザー', () => {
		it('/admin はアクセス可能', () => {
			const result = provider.authorize('/admin', pinIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/admin/children はアクセス可能', () => {
			const result = provider.authorize('/admin/children', pinIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/login は /admin にリダイレクト', () => {
			const result = provider.authorize('/login', pinIdentity, localContext);
			expect(result).toEqual({ allowed: false, redirect: '/admin' });
		});

		it('/ はアクセス可能', () => {
			const result = provider.authorize('/', pinIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/baby はアクセス可能', () => {
			const result = provider.authorize('/baby', pinIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/api/v1/auth/login はアクセス可能', () => {
			const result = provider.authorize('/api/v1/auth/login', pinIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});
	});

	describe('resolveContext（同期テスト）', () => {
		it('identity が null なら context も null', async () => {
			const context = await provider.resolveContext({} as never, null);
			expect(context).toBeNull();
		});

		it('PIN identity なら local/owner コンテキスト', async () => {
			const context = await provider.resolveContext({} as never, pinIdentity);
			expect(context).toEqual({
				tenantId: 'local',
				role: 'owner',
				licenseStatus: 'none',
			});
		});
	});
});
