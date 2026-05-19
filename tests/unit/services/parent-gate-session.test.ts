// tests/unit/services/parent-gate-session.test.ts
// EPIC #2310 子#2313: parent-gate-session service の unit test
//
// AC4: 「不正署名 cookie 拒否」「expired 拒否」「正常 verify 通過」「tenant_id 跨ぎ攻撃テスト」全 PASS

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createParentSession,
	INACTIVITY_TIMEOUT_MS,
	MAX_SESSION_MS,
	refreshParentSession,
	verifyParentSession,
} from '../../../src/lib/server/services/parent-gate-session';

describe('parent-gate-session', () => {
	const tenantId = 'tenant-a';
	const otherTenantId = 'tenant-b';

	beforeEach(() => {
		process.env.PARENT_GATE_COOKIE_SECRET = 'test-secret-do-not-use-in-prod-123456';
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('createParentSession', () => {
		it('returns a non-empty signed cookie value', () => {
			const cookie = createParentSession(tenantId);
			expect(typeof cookie).toBe('string');
			expect(cookie.length).toBeGreaterThan(20);
		});

		it('produces verifiable cookies via verifyParentSession', () => {
			const cookie = createParentSession(tenantId);
			expect(verifyParentSession(cookie, tenantId)).toBe(true);
		});
	});

	describe('verifyParentSession', () => {
		it('returns true for freshly minted cookie', () => {
			const cookie = createParentSession(tenantId);
			expect(verifyParentSession(cookie, tenantId)).toBe(true);
		});

		it('returns false when cookie is undefined', () => {
			expect(verifyParentSession(undefined, tenantId)).toBe(false);
		});

		it('returns false when tenantId is undefined', () => {
			const cookie = createParentSession(tenantId);
			expect(verifyParentSession(cookie, undefined)).toBe(false);
		});

		it('rejects cookie tampered after signing (signature invalid)', () => {
			const cookie = createParentSession(tenantId);
			// 末尾 1 文字を書き換えて改ざん
			const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('a') ? 'b' : 'a'}`;
			expect(verifyParentSession(tampered, tenantId)).toBe(false);
		});

		it('rejects cookie issued for a different tenant (tenant crossing attack)', () => {
			const cookie = createParentSession(tenantId);
			// 別テナント context で検証 → reject
			expect(verifyParentSession(cookie, otherTenantId)).toBe(false);
		});

		it('rejects cookie when inactivity timeout exceeded (15min sliding)', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
			const cookie = createParentSession(tenantId);

			// 15 分 + 1 秒経過
			vi.setSystemTime(Date.now() + INACTIVITY_TIMEOUT_MS + 1000);
			expect(verifyParentSession(cookie, tenantId)).toBe(false);
		});

		it('accepts cookie just before inactivity timeout', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
			const cookie = createParentSession(tenantId);

			// 14 分 59 秒経過 (timeout 直前)
			vi.setSystemTime(Date.now() + INACTIVITY_TIMEOUT_MS - 1000);
			expect(verifyParentSession(cookie, tenantId)).toBe(true);
		});

		it('rejects cookie when hard max session exceeded (verifiedAt fixed even after refresh)', () => {
			vi.useFakeTimers();
			const t0 = new Date('2026-01-01T00:00:00Z').getTime();
			vi.setSystemTime(t0);
			const cookie = createParentSession(tenantId);

			// refresh で lastActiveAt は伸ばし続けるが verifiedAt は固定
			// → 24 時間 + 1 秒で hard max 失効
			let current = cookie;
			for (let i = 0; i < 100; i++) {
				vi.setSystemTime(t0 + (i + 1) * 10 * 60 * 1000); // 10 分ずつ進める
				const refreshed = refreshParentSession(current);
				if (refreshed) current = refreshed;
			}
			// 約 1000 分 = 16.67 時間経過、まだ MAX (24h) 未満
			expect(Date.now() - t0).toBeLessThan(MAX_SESSION_MS);
			expect(verifyParentSession(current, tenantId)).toBe(true);

			// MAX を超えるまで一気に進める (t0 + 24h + 1s)
			vi.setSystemTime(t0 + MAX_SESSION_MS + 1000);
			expect(verifyParentSession(current, tenantId)).toBe(false);
		});

		it('rejects garbage cookie (non-signed payload)', () => {
			expect(verifyParentSession('not-a-valid-cookie', tenantId)).toBe(false);
			expect(verifyParentSession('', tenantId)).toBe(false);
		});
	});

	describe('refreshParentSession', () => {
		it('extends lastActiveAt while preserving verifiedAt', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
			const cookie = createParentSession(tenantId);

			// 10 分経過、verifyOK
			vi.setSystemTime(Date.now() + 10 * 60 * 1000);
			expect(verifyParentSession(cookie, tenantId)).toBe(true);
			const refreshed = refreshParentSession(cookie);
			expect(refreshed).not.toBeNull();
			expect(refreshed).not.toBe(cookie);

			// refresh 後さらに 14 分経過 → 元 cookie は 24 分経過で失効、新 cookie は 14 分でまだ有効
			vi.setSystemTime(Date.now() + 14 * 60 * 1000);
			expect(verifyParentSession(cookie, tenantId)).toBe(false); // 元: 24 分経過
			expect(verifyParentSession(refreshed!, tenantId)).toBe(true); // 新: 14 分経過
		});

		it('returns null for invalid cookie', () => {
			expect(refreshParentSession(undefined)).toBeNull();
			expect(refreshParentSession('not-valid')).toBeNull();
		});
	});
});
