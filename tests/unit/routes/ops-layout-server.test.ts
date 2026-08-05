// tests/unit/routes/ops-layout-server.test.ts
// #820 PR-C: /ops 認可を Cognito ops group ベースに切替えたことの回帰テスト。
//
// 旧実装（OPS_SECRET_KEY Bearer）では Bearer token が一致すれば通過していた。
// 新実装では locals.identity に ops group 所属の Cognito identity が居ることを要求する。
//
// #4266: CloudFront の IP allowlist 廃止に伴い条件を **ops group + MFA** に強化した
// （弱めていない）。MFA を経ていない ops identity は 403 になる。fail-closed の網羅は
// tests/unit/routes/ops-mfa-guard.test.ts。

import { describe, expect, it } from 'vitest';
import type { Identity } from '$lib/server/auth/types';
import { load } from '../../../src/routes/ops/+layout.server';

function makeEvent(identity: Identity | null) {
	return {
		locals: { identity },
	} as unknown as Parameters<typeof load>[0];
}

function isHttpError(e: unknown): e is { status: number; body: { message: string } } {
	return (
		typeof e === 'object' &&
		e !== null &&
		'status' in e &&
		typeof (e as { status: unknown }).status === 'number'
	);
}

describe('#820 /ops/+layout.server.ts', () => {
	it('identity=null は 403', async () => {
		try {
			await load(makeEvent(null));
			expect.fail('403 がスローされるはず');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
	});

	it('local identity は 403', async () => {
		try {
			await load(makeEvent({ type: 'local' }));
			expect.fail('403 がスローされるはず');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
	});

	it('cognito identity で groups 未指定は 403', async () => {
		try {
			await load(
				makeEvent({
					type: 'cognito',
					userId: 'u-1',
					email: 'a@b.com',
				}),
			);
			expect.fail('403 がスローされるはず');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
	});

	it('cognito identity で groups=["random"] は 403', async () => {
		try {
			await load(
				makeEvent({
					type: 'cognito',
					userId: 'u-1',
					email: 'a@b.com',
					groups: ['random'],
				}),
			);
			expect.fail('403 がスローされるはず');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
	});

	it('cognito identity で groups=["ops"] でも MFA 未経由は 403 (#4266)', async () => {
		try {
			await load(
				makeEvent({
					type: 'cognito',
					userId: 'u-ops',
					email: 'ops@example.com',
					groups: ['ops'],
				}),
			);
			expect.fail('403 がスローされるはず');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
	});

	it('cognito identity で groups=["ops"] かつ MFA 済は通過', async () => {
		const result = await load(
			makeEvent({
				type: 'cognito',
				userId: 'u-ops',
				email: 'ops@example.com',
				groups: ['ops'],
				mfaAuthenticated: true,
			}),
		);
		expect(result).toEqual({});
	});

	it('cognito identity で groups=["ops", "other"] かつ MFA 済は通過', async () => {
		const result = await load(
			makeEvent({
				type: 'cognito',
				userId: 'u-ops',
				email: 'ops@example.com',
				groups: ['ops', 'other'],
				mfaAuthenticated: true,
			}),
		);
		expect(result).toEqual({});
	});
});
