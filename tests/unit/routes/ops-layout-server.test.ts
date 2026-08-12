// tests/unit/routes/ops-layout-server.test.ts
// #820 PR-C: /ops 認可を Cognito ops group ベースに切替えたことの回帰テスト。
//
// 旧実装（OPS_SECRET_KEY Bearer）では Bearer token が一致すれば通過していた。
// 新実装では locals.identity に ops group 所属の Cognito identity が居ることを要求する。
//
// #4266 → #4363: 一度 **ops group + MFA** に強化したが、オーナー決裁 (2026-08-06) により
// MFA 要求を撤去し、現在の条件は **ops group 所属のみ**。group 側の fail-closed
// (非所属 / local / null は 403) は不変。現行条件の網羅は
// tests/unit/routes/ops-mfa-not-required.test.ts、MFA 機構 (フラグを戻した場合) の網羅は
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

	it('cognito identity で groups=["ops"] なら MFA 未経由でも通過する (#4363)', async () => {
		// #4363 (オーナー決裁 2026-08-06) で /ops の MFA 要求を撤去した。緩めたのは MFA の
		// 1 条件だけで、上の「group 非所属 / local / null は 403」は不変 (この file の他 it)。
		await expect(
			load(
				makeEvent({
					type: 'cognito',
					userId: 'u-ops',
					email: 'ops@example.com',
					groups: ['ops'],
				}),
			),
		).resolves.toEqual({});
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
