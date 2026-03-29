// tests/unit/services/consent-service.test.ts
// 同意サービスのユニットテスト (#0192)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsentRecord } from '../../../src/lib/server/auth/entities';

const mockFindLatestConsent = vi.fn();
const mockRecordConsent = vi.fn();
const mockFindAllConsents = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findLatestConsent: (...args: unknown[]) => mockFindLatestConsent(...args),
			recordConsent: (...args: unknown[]) => mockRecordConsent(...args),
			findAllConsents: (...args: unknown[]) => mockFindAllConsents(...args),
		},
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe('consent-service', () => {
	describe('checkConsent', () => {
		it('両方の同意が最新バージョンの場合 needsReconsent=false', async () => {
			const { checkConsent, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } = await import(
				'../../../src/lib/server/services/consent-service'
			);

			mockFindLatestConsent
				.mockResolvedValueOnce({ version: CURRENT_TERMS_VERSION } as ConsentRecord)
				.mockResolvedValueOnce({ version: CURRENT_PRIVACY_VERSION } as ConsentRecord);

			const result = await checkConsent('tenant-1');

			expect(result.needsReconsent).toBe(false);
			expect(result.termsAccepted).toBe(true);
			expect(result.privacyAccepted).toBe(true);
		});

		it('利用規約が古いバージョンの場合 needsReconsent=true', async () => {
			const { checkConsent, CURRENT_PRIVACY_VERSION } = await import(
				'../../../src/lib/server/services/consent-service'
			);

			mockFindLatestConsent
				.mockResolvedValueOnce({ version: '2025-01-01' } as ConsentRecord)
				.mockResolvedValueOnce({ version: CURRENT_PRIVACY_VERSION } as ConsentRecord);

			const result = await checkConsent('tenant-1');

			expect(result.needsReconsent).toBe(true);
			expect(result.termsAccepted).toBe(false);
			expect(result.privacyAccepted).toBe(true);
		});

		it('同意記録がない場合 needsReconsent=true', async () => {
			const { checkConsent } = await import('../../../src/lib/server/services/consent-service');

			mockFindLatestConsent.mockResolvedValue(undefined);

			const result = await checkConsent('tenant-1');

			expect(result.needsReconsent).toBe(true);
			expect(result.termsAccepted).toBe(false);
			expect(result.privacyAccepted).toBe(false);
		});
	});

	describe('recordConsent', () => {
		it('指定した種別の同意を記録する', async () => {
			const { recordConsent, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } = await import(
				'../../../src/lib/server/services/consent-service'
			);

			mockRecordConsent.mockImplementation(async (input: { type: string; version: string }) => ({
				...input,
				consentedAt: '2026-03-29T00:00:00Z',
			}));

			const records = await recordConsent(
				't-1',
				'u-1',
				['terms', 'privacy'],
				'127.0.0.1',
				'Mozilla/5.0',
			);

			expect(records).toHaveLength(2);
			expect(mockRecordConsent).toHaveBeenCalledTimes(2);
			expect(mockRecordConsent).toHaveBeenCalledWith(
				expect.objectContaining({ tenantId: 't-1', type: 'terms', version: CURRENT_TERMS_VERSION }),
			);
			expect(mockRecordConsent).toHaveBeenCalledWith(
				expect.objectContaining({
					tenantId: 't-1',
					type: 'privacy',
					version: CURRENT_PRIVACY_VERSION,
				}),
			);
		});
	});

	describe('getConsentHistory', () => {
		it('テナントの全同意履歴を返す', async () => {
			const { getConsentHistory } = await import(
				'../../../src/lib/server/services/consent-service'
			);

			const mockRecords: ConsentRecord[] = [
				{
					tenantId: 't-1',
					userId: 'u-1',
					type: 'terms',
					version: '2026-03-29',
					consentedAt: '2026-03-29T00:00:00Z',
					ipAddress: '127.0.0.1',
					userAgent: 'test',
				},
			];
			mockFindAllConsents.mockResolvedValue(mockRecords);

			const result = await getConsentHistory('t-1');

			expect(result).toEqual(mockRecords);
			expect(mockFindAllConsents).toHaveBeenCalledWith('t-1');
		});
	});
});
