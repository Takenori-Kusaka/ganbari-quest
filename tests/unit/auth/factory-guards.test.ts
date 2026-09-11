import { describe, expect, it } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import {
	requireChildAccess,
	requireChildScope,
	requireRole,
} from '../../../src/lib/server/auth/guards';
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
		expect(() => requireChildAccess(locals, asChildId(1))).not.toThrow();
		expect(() => requireChildAccess(locals, asChildId(99))).not.toThrow();
	});

	it('parent は任意の childId にアクセス可能', () => {
		const locals = makeLocals(makeContext({ role: 'parent' }));
		expect(() => requireChildAccess(locals, asChildId(1))).not.toThrow();
	});

	it('child は自分の childId にアクセス可能', () => {
		const locals = makeLocals(makeContext({ role: 'child', childId: asChildId(5) }));
		expect(() => requireChildAccess(locals, asChildId(5))).not.toThrow();
	});

	it('child は他の childId にアクセス不可（403）', () => {
		const locals = makeLocals(makeContext({ role: 'child', childId: asChildId(5) }));
		expect(() => requireChildAccess(locals, asChildId(99))).toThrow();
	});

	it('context なしで 401', () => {
		const locals = makeLocals(null);
		expect(() => requireChildAccess(locals, asChildId(1))).toThrow();
	});

	// 子供レコードに紐づいていない child セッション (context.childId 未解決) は、
	// 「誰の childId でも一致しない」= 全部 403 になる。ここを開けると
	// 「未紐づけなら誰にでもなれる」抜け道になるため fail-closed で固定する。
	it('childId 未解決の child は自分の分でも 403 (fail-closed)', () => {
		const locals = makeLocals(makeContext({ role: 'child' }));
		expect(() => requireChildAccess(locals, asChildId(1))).toThrow();
	});
});

describe('requireChildScope', () => {
	it('owner / parent は null (絞り込みなし)', () => {
		expect(requireChildScope(makeLocals(makeContext({ role: 'owner' })))).toBeNull();
		expect(requireChildScope(makeLocals(makeContext({ role: 'parent' })))).toBeNull();
	});

	it('child は自分の childId を返す', () => {
		const locals = makeLocals(makeContext({ role: 'child', childId: asChildId(5) }));
		expect(requireChildScope(locals)).toBe(asChildId(5));
	});

	it('childId 未解決の child は 403 (絞り込めないまま素通しさせない)', () => {
		const locals = makeLocals(makeContext({ role: 'child' }));
		expect(() => requireChildScope(locals)).toThrow();
	});

	it('context なしで 401', () => {
		expect(() => requireChildScope(makeLocals(null))).toThrow();
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
