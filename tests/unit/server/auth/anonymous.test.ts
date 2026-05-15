// tests/unit/server/auth/anonymous.test.ts
// ADR-0048 §決定 P-1.6: AnonymousAuthProvider は dummy user `anon-{requestId}` +
// role='owner' + tenantId='demo' + licenseStatus=ACTIVE を返す。

import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { AnonymousAuthProvider } from '../../../../src/lib/server/auth/providers/anonymous';

function makeEvent(requestId?: string): RequestEvent {
	const locals = requestId ? { requestId } : {};
	return {
		locals,
		url: new URL('http://localhost/'),
	} as unknown as RequestEvent;
}

describe('AnonymousAuthProvider (ADR-0048 §決定 P-1.6)', () => {
	const provider = new AnonymousAuthProvider();

	describe('resolveIdentity', () => {
		it('locals.requestId が設定されていれば anon-{requestId} を返す', async () => {
			const event = makeEvent('req-12345');
			const identity = await provider.resolveIdentity(event);
			expect(identity).toBeDefined();
			expect(identity.type).toBe('anonymous');
			if (identity.type === 'anonymous') {
				expect(identity.userId).toBe('anon-req-12345');
				expect(identity.email).toBe('anon@demo.local');
			}
		});

		it('locals.requestId 未設定でも fallback で identity を返す', async () => {
			const event = makeEvent();
			const identity = await provider.resolveIdentity(event);
			expect(identity.type).toBe('anonymous');
			if (identity.type === 'anonymous') {
				expect(identity.userId).toMatch(/^anon-/);
			}
		});

		it('複数回呼び出しでも常に anonymous type を返す', async () => {
			const event = makeEvent('req-A');
			const a = await provider.resolveIdentity(event);
			const b = await provider.resolveIdentity(event);
			expect(a.type).toBe('anonymous');
			expect(b.type).toBe('anonymous');
			if (a.type === 'anonymous' && b.type === 'anonymous') {
				expect(a.userId).toBe(b.userId);
			}
		});
	});

	describe('resolveContext', () => {
		it('tenantId="demo" / role="owner" / licenseStatus="active" を返す', async () => {
			const event = makeEvent('req-1');
			const context = await provider.resolveContext(event, null);
			expect(context).toBeDefined();
			expect(context.tenantId).toBe('demo');
			expect(context.role).toBe('owner');
			expect(context.licenseStatus).toBe('active');
			expect(context.tenantStatus).toBe('active');
		});

		it('identity の中身に依存しない (常に固定 context)', async () => {
			const event = makeEvent('req-1');
			const identity = await provider.resolveIdentity(event);
			const a = await provider.resolveContext(event, identity);
			const b = await provider.resolveContext(event, null);
			expect(a).toEqual(b);
		});
	});

	describe('authorize (demo Lambda は全 path allow)', () => {
		it('admin path は allow', () => {
			const result = provider.authorize('/admin/home', null, null);
			expect(result.allowed).toBe(true);
		});

		it('child path は allow', () => {
			const result = provider.authorize('/elementary/home', null, null);
			expect(result.allowed).toBe(true);
		});

		it('ops path も allow (見せるだけ)', () => {
			const result = provider.authorize('/ops/dashboard', null, null);
			expect(result.allowed).toBe(true);
		});

		it('未認証扱いの auth path も allow (demo は完全 stateless)', () => {
			const result = provider.authorize('/auth/login', null, null);
			expect(result.allowed).toBe(true);
		});
	});

	describe('stateless 検証 (AWS Lambda Best Practices)', () => {
		it('複数 event に対し独立した identity を発行する (cross-request leak なし)', async () => {
			const eventA = makeEvent('req-A');
			const eventB = makeEvent('req-B');
			const idA = await provider.resolveIdentity(eventA);
			const idB = await provider.resolveIdentity(eventB);
			if (idA.type === 'anonymous' && idB.type === 'anonymous') {
				expect(idA.userId).toBe('anon-req-A');
				expect(idB.userId).toBe('anon-req-B');
				expect(idA.userId).not.toBe(idB.userId);
			}
		});
	});
});
