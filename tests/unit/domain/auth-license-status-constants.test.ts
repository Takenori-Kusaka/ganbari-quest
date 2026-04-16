// tests/unit/domain/auth-license-status-constants.test.ts
// #972: AUTH_LICENSE_STATUS 定数 / ヘルパの網羅性テスト
//
// 注: SubscriptionStatus → AuthLicenseStatus の正規化ロジック自体は
// src/lib/server/auth/providers/cognito.ts の本体で実装されており、
// そちらの単体テストで担保する。本ファイルは定数値と集合の整合のみ検証。

import { describe, expect, it } from 'vitest';
import {
	ALL_AUTH_LICENSE_STATUSES,
	AUTH_LICENSE_STATUS,
	isAuthLicenseActive,
} from '../../../src/lib/domain/constants/auth-license-status';

describe('AUTH_LICENSE_STATUS 定数', () => {
	it('値は既存 cookie / API レスポンス互換のため小文字', () => {
		expect(AUTH_LICENSE_STATUS.ACTIVE).toBe('active');
		expect(AUTH_LICENSE_STATUS.SUSPENDED).toBe('suspended');
		expect(AUTH_LICENSE_STATUS.EXPIRED).toBe('expired');
		expect(AUTH_LICENSE_STATUS.NONE).toBe('none');
	});

	it('ALL_AUTH_LICENSE_STATUSES は全 status を含む (重複なし)', () => {
		expect(ALL_AUTH_LICENSE_STATUSES).toHaveLength(4);
		expect(new Set(ALL_AUTH_LICENSE_STATUSES).size).toBe(ALL_AUTH_LICENSE_STATUSES.length);
	});

	it('ALL_AUTH_LICENSE_STATUSES は AUTH_LICENSE_STATUS の全 value と一致', () => {
		const values = Object.values(AUTH_LICENSE_STATUS).sort();
		const all = [...ALL_AUTH_LICENSE_STATUSES].sort();
		expect(all).toEqual(values);
	});
});

describe('ヘルパ関数', () => {
	it('isAuthLicenseActive は ACTIVE のみ true', () => {
		expect(isAuthLicenseActive(AUTH_LICENSE_STATUS.ACTIVE)).toBe(true);
		expect(isAuthLicenseActive(AUTH_LICENSE_STATUS.SUSPENDED)).toBe(false);
		expect(isAuthLicenseActive(AUTH_LICENSE_STATUS.EXPIRED)).toBe(false);
		expect(isAuthLicenseActive(AUTH_LICENSE_STATUS.NONE)).toBe(false);
	});
});
