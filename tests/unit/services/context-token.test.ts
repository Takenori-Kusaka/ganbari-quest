// tests/unit/services/context-token.test.ts
// Context トークン署名/検証のユニットテスト (#0123: viewer廃止)

import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import {
	type ContextTokenClaims,
	getContextMaxAge,
	signContext,
	verifyContext,
} from '../../../src/lib/server/auth/context-token';
import type { AuthContext } from '../../../src/lib/server/auth/types';

const ownerContext: ContextTokenClaims = {
	tenantId: 't-test',
	role: 'owner',
};

const childContext: ContextTokenClaims = {
	tenantId: 't-test',
	role: 'child',
	childId: asChildId(42),
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

		// #3963: 課金状態をトークンに焼き込むと、DB 反映後も最大 24h 古い値が使われる
		it('plan / licenseStatus / tenantStatus はトークンに焼き込まれない', () => {
			const fullContext: AuthContext = {
				tenantId: 't-test',
				role: 'owner',
				licenseStatus: 'active',
				tenantStatus: 'active',
				plan: 'family-monthly',
			};

			const token = signContext(fullContext);

			// payload を直接デコードして、そもそも載っていないことを確認する
			const payload = JSON.parse(
				Buffer.from(token.split('.')[0] ?? '', 'base64url').toString(),
			) as Record<string, unknown>;
			expect(payload).not.toHaveProperty('plan');
			expect(payload).not.toHaveProperty('licenseStatus');
			expect(payload).not.toHaveProperty('tenantStatus');

			expect(verifyContext(token)).toEqual({
				tenantId: 't-test',
				role: 'owner',
				childId: undefined,
			});
		});

		// 旧形式トークン (plan 入り) を持つブラウザが強制ログアウトされないこと、かつ
		// 焼き込まれた古い値が読み出されないこと
		it('旧形式トークンは受理するが、焼き込まれた課金状態は読まない', () => {
			const now = Math.floor(Date.now() / 1000);
			const legacyPayload = {
				tenantId: 't-test',
				role: 'owner',
				licenseStatus: 'active',
				tenantStatus: 'active',
				plan: 'monthly',
				iat: now,
				exp: now + 3600,
			};
			const encoded = Buffer.from(JSON.stringify(legacyPayload)).toString('base64url');
			const signature = createHmac('sha256', 'test-secret-key-for-unit-tests')
				.update(encoded)
				.digest('base64url');

			expect(verifyContext(`${encoded}.${signature}`)).toEqual({
				tenantId: 't-test',
				role: 'owner',
				childId: undefined,
			});
		});
	});

	describe('有効期限', () => {
		it('期限切れトークンは null を返す', () => {
			const token = signContext(ownerContext);

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
			const parentCtx: ContextTokenClaims = { tenantId: 't-1', role: 'parent' };
			expect(getContextMaxAge(parentCtx)).toBe(30 * 60);
		});

		it('child は 24時間', () => {
			expect(getContextMaxAge(childContext)).toBe(24 * 60 * 60);
		});
	});
});
