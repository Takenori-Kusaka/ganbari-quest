// tests/unit/server/audit-actor.test.ts
// #3474 item 3: 監査 actor 解決の全 AUTH_MODE 網羅 (NUC=local の undefined → nuc-local 根治)。

import { describe, expect, it } from 'vitest';
import {
	ANONYMOUS_ACTOR,
	NUC_LOCAL_ACTOR,
	resolveAuditActor,
} from '../../../src/lib/server/auth/audit-actor';

describe('#3474 resolveAuditActor', () => {
	it('cognito は実 userId を返す', () => {
		expect(resolveAuditActor({ type: 'cognito', userId: 'sub-123', email: 'a@b.c' })).toBe(
			'sub-123',
		);
	});

	it('local (NUC) は nuc-local を返す (旧実装は undefined)', () => {
		expect(resolveAuditActor({ type: 'local' })).toBe(NUC_LOCAL_ACTOR);
	});

	it('anonymous (demo) は anonymous を返す', () => {
		expect(resolveAuditActor({ type: 'anonymous', userId: 'anon-1', email: 'x@y.z' })).toBe(
			ANONYMOUS_ACTOR,
		);
	});

	it('null / undefined は unknown を返す', () => {
		expect(resolveAuditActor(null)).toBe('unknown');
		expect(resolveAuditActor(undefined)).toBe('unknown');
	});
});
