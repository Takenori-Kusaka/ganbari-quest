// tests/unit/server/db/demo/auth-repo.test.ts
// ADR-0048 §決定 §2: demo Auth Repo は anonymous auth 用に最小限の dummy Tenant / Membership
// を返す。production Cognito UserPool には IAM 上アクセスできない。

import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_STATUS } from '../../../../../src/lib/domain/constants/subscription-status';
import * as authRepo from '../../../../../src/lib/server/db/demo/auth-repo';

describe('demo/auth-repo', () => {
	describe('Tenant (demo tenant のみ存在)', () => {
		it('findTenantById("demo") は dummy Tenant を返す', async () => {
			const tenant = await authRepo.findTenantById('demo');
			expect(tenant).toBeDefined();
			expect(tenant?.tenantId).toBe('demo');
			expect(tenant?.name).toContain('デモ');
			expect(tenant?.status).toBe('active');
		});

		it('findTenantById(他 id) は undefined', async () => {
			expect(await authRepo.findTenantById('other')).toBeUndefined();
		});

		it('listAllTenants は demo 1 件のみ', async () => {
			const all = await authRepo.listAllTenants();
			expect(all.length).toBe(1);
			expect(all[0]?.tenantId).toBe('demo');
		});

		it('updateTenantStatus / deleteTenant は no-op で例外を投げない', async () => {
			await expect(
				authRepo.updateTenantStatus('demo', SUBSCRIPTION_STATUS.TERMINATED),
			).resolves.toBeUndefined();
			await expect(authRepo.deleteTenant('demo')).resolves.toBeUndefined();
		});
	});

	describe('User (常に存在しない)', () => {
		it('findUserById / findUserByEmail は undefined を返す', async () => {
			expect(await authRepo.findUserById('any')).toBeUndefined();
			expect(await authRepo.findUserByEmail('any@example.com')).toBeUndefined();
		});

		it('createUser は input から AuthUser を返す (no-op for fixture)', async () => {
			const user = await authRepo.createUser({
				email: 'test@example.com',
				provider: 'cognito',
			});
			expect(user.email).toBe('test@example.com');
			expect(user.userId).toBeTruthy();
		});
	});

	describe('Membership (demo tenant のみ)', () => {
		it('findMembership(demo) は owner role を返す', async () => {
			const membership = await authRepo.findMembership('any-user', 'demo');
			expect(membership).toBeDefined();
			expect(membership?.role).toBe('owner');
			expect(membership?.tenantId).toBe('demo');
		});

		it('findMembership(他 tenant) は undefined', async () => {
			expect(await authRepo.findMembership('any', 'other')).toBeUndefined();
		});
	});

	describe('License Key (常に存在しない、demo Lambda は Secrets Manager 権限なし)', () => {
		it('findLicenseKey は undefined を返す', async () => {
			expect(await authRepo.findLicenseKey('any-key')).toBeUndefined();
		});

		it('listLicenseKeysByTenant は空ページを返す', async () => {
			const page = await authRepo.listLicenseKeysByTenant('demo');
			expect(page).toEqual({ items: [], cursor: null });
		});

		it('countLicenseKeys は 0', async () => {
			expect(await authRepo.countLicenseKeys()).toBe(0);
		});
	});

	describe('Consent (Stub)', () => {
		it('recordConsent は input から ConsentRecord を返す (no-op)', async () => {
			const consent = await authRepo.recordConsent({
				tenantId: 'demo',
				userId: 'any',
				type: 'terms',
				version: 'v1',
				ipAddress: '127.0.0.1',
				userAgent: 'test',
			});
			expect(consent.type).toBe('terms');
			expect(consent.version).toBe('v1');
		});

		it('findLatestConsent は undefined を返す', async () => {
			expect(await authRepo.findLatestConsent('demo', 'terms')).toBeUndefined();
		});
	});
});
