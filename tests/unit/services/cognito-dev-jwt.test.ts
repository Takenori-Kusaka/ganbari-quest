// tests/unit/services/cognito-dev-jwt.test.ts
// #820: 開発用ダミー JWT の cognito:groups claim ラウンドトリップ
//
// @vitest-environment node
// jsdom だと jose の Uint8Array instanceof チェックが realm 越しで失敗するため Node 環境で実行

import { describe, expect, it } from 'vitest';
import {
	signDevIdentityToken,
	verifyDevIdentityToken,
} from '$lib/server/auth/providers/cognito-dev-jwt';

describe('#820 dev JWT with cognito:groups', () => {
	it('groups なしで sign → verify すると cognito:groups は undefined', async () => {
		const token = await signDevIdentityToken({
			userId: 'u-1',
			email: 'a@b.com',
		});
		const claims = await verifyDevIdentityToken(token);
		expect(claims).not.toBeNull();
		expect(claims?.sub).toBe('u-1');
		expect(claims?.['cognito:groups']).toBeUndefined();
	});

	it('groups=["ops"] で sign → verify すると cognito:groups に ["ops"] が復元される', async () => {
		const token = await signDevIdentityToken({
			userId: 'u-ops-1',
			email: 'ops@example.com',
			groups: ['ops'],
		});
		const claims = await verifyDevIdentityToken(token);
		expect(claims?.['cognito:groups']).toEqual(['ops']);
	});

	it('groups=[] で sign すると cognito:groups は payload に含まれず undefined になる', async () => {
		const token = await signDevIdentityToken({
			userId: 'u-empty-1',
			email: 'empty@example.com',
			groups: [],
		});
		const claims = await verifyDevIdentityToken(token);
		expect(claims?.['cognito:groups']).toBeUndefined();
	});

	it('groups=["ops", "admin"] で sign → verify すると両方の group が復元される', async () => {
		const token = await signDevIdentityToken({
			userId: 'u-multi-1',
			email: 'multi@example.com',
			groups: ['ops', 'admin'],
		});
		const claims = await verifyDevIdentityToken(token);
		expect(claims?.['cognito:groups']).toEqual(['ops', 'admin']);
	});
});
