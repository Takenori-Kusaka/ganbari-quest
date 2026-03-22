// tests/unit/services/context-token.test.ts
// Context トークン署名/検証のユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getContextMaxAge,
	signContext,
	verifyContext,
} from '../../../src/lib/server/auth/context-token';
import type { AuthContext } from '../../../src/lib/server/auth/types';

const ownerContext: AuthContext = {
	tenantId: 't-test',
	role: 'owner',
	licenseStatus: 'active',
};

const childContext: AuthContext = {
	tenantId: 't-test',
	role: 'child',
	childId: 42,
	licenseStatus: 'active',
};

describe('Context Token', () => {
	beforeEach(() => {
		process.env.CONTEXT_TOKEN_SECRET = 'test-secret-key-for-unit-tests';
	});

	afterEach(() => {
		process.env.CONTEXT_TOKEN_SECRET = undefined;
	});

	describe('signContext + verifyContext', () => {
		it('正常な署名と検証', () => {
			const token = signContext(ownerContext);
			const result = verifyContext(token);
			expect(result).toEqual(ownerContext);
		});

		it('childId が正しく保持される', () => {
			const token = signContext(childContext);
			const result = verifyContext(token);
			expect(result).toEqual(childContext);
		});

		it('トークン改ざんで null を返す', () => {
			const token = signContext(ownerContext);
			const tampered = `x${token.slice(1)}`;
			expect(verifyContext(tampered)).toBeNull();
		});

		it('署名部分を改ざんで null を返す', () => {
			const token = signContext(ownerContext);
			const parts = token.split('.');
			parts[1] = 'invalid-signature';
			expect(verifyContext(parts.join('.'))).toBeNull();
		});

		it('不正な形式で null を返す', () => {
			expect(verifyContext('')).toBeNull();
			expect(verifyContext('no-dot')).toBeNull();
			expect(verifyContext('a.b.c')).toBeNull();
		});
	});

	describe('有効期限', () => {
		it('期限切れトークンは null を返す', () => {
			const token = signContext(ownerContext);

			// 25時間後にジャンプ
			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);

			expect(verifyContext(token)).toBeNull();

			vi.useRealTimers();
		});
	});

	describe('getContextMaxAge', () => {
		it('owner は 24時間', () => {
			expect(getContextMaxAge(ownerContext)).toBe(24 * 60 * 60);
		});

		it('parent は 30分', () => {
			const parentCtx: AuthContext = { tenantId: 't-1', role: 'parent', licenseStatus: 'active' };
			expect(getContextMaxAge(parentCtx)).toBe(30 * 60);
		});

		it('child は 24時間', () => {
			expect(getContextMaxAge(childContext)).toBe(24 * 60 * 60);
		});

		it('viewer は 24時間', () => {
			const viewerCtx: AuthContext = { tenantId: 't-1', role: 'viewer', licenseStatus: 'active' };
			expect(getContextMaxAge(viewerCtx)).toBe(24 * 60 * 60);
		});
	});
});
