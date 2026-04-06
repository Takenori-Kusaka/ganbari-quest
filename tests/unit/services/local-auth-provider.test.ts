// tests/unit/services/local-auth-provider.test.ts
// LocalAuthProvider のテスト（#0123: PIN廃止、常に認証済み）

import { describe, expect, it } from 'vitest';
import { LocalAuthProvider } from '../../../src/lib/server/auth/providers/local';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

const provider = new LocalAuthProvider();

const localIdentity: Identity = { type: 'local' };
const localContext: AuthContext = {
	tenantId: 'local',
	role: 'owner',
	licenseStatus: 'none',
};

describe('LocalAuthProvider', () => {
	describe('authorize — 全ルート許可', () => {
		it('/admin はアクセス可能', () => {
			const result = provider.authorize('/admin', localIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/admin/children はアクセス可能', () => {
			const result = provider.authorize('/admin/children', localIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/admin/settings はアクセス可能', () => {
			const result = provider.authorize('/admin/settings', localIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/ はアクセス可能', () => {
			const result = provider.authorize('/', localIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/baby はアクセス可能', () => {
			const result = provider.authorize('/baby', localIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/preschool はアクセス可能', () => {
			const result = provider.authorize('/preschool', localIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/api/v1/activities はアクセス可能', () => {
			const result = provider.authorize('/api/v1/activities', localIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/api/health はアクセス可能', () => {
			const result = provider.authorize('/api/health', localIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('/setup はアクセス可能', () => {
			const result = provider.authorize('/setup', localIdentity, localContext);
			expect(result).toEqual({ allowed: true });
		});

		it('null identity でもアクセス可能（local は常に許可）', () => {
			const result = provider.authorize('/admin', null, null);
			expect(result).toEqual({ allowed: true });
		});
	});

	describe('resolveIdentity', () => {
		it('常に local Identity を返す', async () => {
			const identity = await provider.resolveIdentity({} as never);
			expect(identity).toEqual({ type: 'local' });
		});
	});

	describe('resolveContext', () => {
		it('常に local/owner コンテキストを返す', async () => {
			const context = await provider.resolveContext({} as never, localIdentity);
			expect(context).toEqual({
				tenantId: 'local',
				role: 'owner',
				licenseStatus: 'none',
			});
		});

		it('identity が null でも local/owner コンテキストを返す', async () => {
			const context = await provider.resolveContext({} as never, null);
			expect(context).toEqual({
				tenantId: 'local',
				role: 'owner',
				licenseStatus: 'none',
			});
		});
	});
});
