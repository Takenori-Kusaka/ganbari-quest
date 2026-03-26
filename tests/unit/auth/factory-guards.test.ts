import { describe, expect, it } from 'vitest';
import { requireChildAccess, requireRole } from '../../../src/lib/server/auth/factory';
import type { AuthContext } from '../../../src/lib/server/auth/types';

function makeLocals(context: AuthContext | null): App.Locals {
	return {
		authenticated: context !== null,
		identity: context ? { type: 'cognito', userId: 'u1', email: 'test@example.com' } : null,
		context,
	} as App.Locals;
}

function makeContext(overrides: Partial<AuthContext> = {}): AuthContext {
	return {
		tenantId: 't-test',
		role: 'owner',
		licenseStatus: 'active',
		...overrides,
	};
}

describe('requireChildAccess', () => {
	it('owner は任意の childId にアクセス可能', () => {
		const locals = makeLocals(makeContext({ role: 'owner' }));
		expect(() => requireChildAccess(locals, 1)).not.toThrow();
		expect(() => requireChildAccess(locals, 99)).not.toThrow();
	});

	it('parent は任意の childId にアクセス可能', () => {
		const locals = makeLocals(makeContext({ role: 'parent' }));
		expect(() => requireChildAccess(locals, 1)).not.toThrow();
	});

	it('child は自分の childId にアクセス可能', () => {
		const locals = makeLocals(makeContext({ role: 'child', childId: 5 }));
		expect(() => requireChildAccess(locals, 5)).not.toThrow();
	});

	it('child は他の childId にアクセス不可（403）', () => {
		const locals = makeLocals(makeContext({ role: 'child', childId: 5 }));
		expect(() => requireChildAccess(locals, 99)).toThrow();
	});

	it('context なしで 401', () => {
		const locals = makeLocals(null);
		expect(() => requireChildAccess(locals, 1)).toThrow();
	});
});

describe('requireRole', () => {
	it('許可ロール一致で通過', () => {
		const locals = makeLocals(makeContext({ role: 'owner' }));
		expect(() => requireRole(locals, ['owner', 'parent'])).not.toThrow();
	});

	it('許可ロール不一致で 403', () => {
		const locals = makeLocals(makeContext({ role: 'child' }));
		expect(() => requireRole(locals, ['owner', 'parent'])).toThrow();
	});

	it('context なしで 401', () => {
		const locals = makeLocals(null);
		expect(() => requireRole(locals, ['owner'])).toThrow();
	});
});
