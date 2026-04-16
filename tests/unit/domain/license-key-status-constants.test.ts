// tests/unit/domain/license-key-status-constants.test.ts
// #972: LICENSE_KEY_STATUS 定数 / ヘルパの網羅性テスト

import { describe, expect, it } from 'vitest';
import {
	ALL_LICENSE_KEY_STATUSES,
	isLicenseKeyActive,
	isLicenseKeyConsumed,
	isLicenseKeyRevoked,
	LICENSE_KEY_STATUS,
} from '../../../src/lib/domain/constants/license-key-status';

describe('LICENSE_KEY_STATUS 定数', () => {
	it('値は既存 DB との後方互換性のため kebab-case', () => {
		expect(LICENSE_KEY_STATUS.ACTIVE).toBe('active');
		expect(LICENSE_KEY_STATUS.CONSUMED).toBe('consumed');
		expect(LICENSE_KEY_STATUS.REVOKED).toBe('revoked');
	});

	it('ALL_LICENSE_KEY_STATUSES は全 status を含む (重複なし)', () => {
		expect(ALL_LICENSE_KEY_STATUSES).toHaveLength(3);
		expect(new Set(ALL_LICENSE_KEY_STATUSES).size).toBe(ALL_LICENSE_KEY_STATUSES.length);
	});

	it('ALL_LICENSE_KEY_STATUSES は LICENSE_KEY_STATUS の全 value と一致', () => {
		const values = Object.values(LICENSE_KEY_STATUS).sort();
		const all = [...ALL_LICENSE_KEY_STATUSES].sort();
		expect(all).toEqual(values);
	});
});

describe('ヘルパ関数 (相互排他)', () => {
	it('ACTIVE のみ isLicenseKeyActive === true', () => {
		expect(isLicenseKeyActive(LICENSE_KEY_STATUS.ACTIVE)).toBe(true);
		expect(isLicenseKeyActive(LICENSE_KEY_STATUS.CONSUMED)).toBe(false);
		expect(isLicenseKeyActive(LICENSE_KEY_STATUS.REVOKED)).toBe(false);
	});

	it('CONSUMED のみ isLicenseKeyConsumed === true', () => {
		expect(isLicenseKeyConsumed(LICENSE_KEY_STATUS.CONSUMED)).toBe(true);
		expect(isLicenseKeyConsumed(LICENSE_KEY_STATUS.ACTIVE)).toBe(false);
		expect(isLicenseKeyConsumed(LICENSE_KEY_STATUS.REVOKED)).toBe(false);
	});

	it('REVOKED のみ isLicenseKeyRevoked === true', () => {
		expect(isLicenseKeyRevoked(LICENSE_KEY_STATUS.REVOKED)).toBe(true);
		expect(isLicenseKeyRevoked(LICENSE_KEY_STATUS.ACTIVE)).toBe(false);
		expect(isLicenseKeyRevoked(LICENSE_KEY_STATUS.CONSUMED)).toBe(false);
	});

	it('各 status はちょうど 1 つのヘルパで true になる (partition)', () => {
		for (const s of ALL_LICENSE_KEY_STATUSES) {
			const trueCount = [
				isLicenseKeyActive(s),
				isLicenseKeyConsumed(s),
				isLicenseKeyRevoked(s),
			].filter(Boolean).length;
			expect(trueCount).toBe(1);
		}
	});
});
