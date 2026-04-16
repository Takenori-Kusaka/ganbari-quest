// tests/unit/services/ops-authz.test.ts
// #820: /ops 認可ヘルパのユニットテスト

import { describe, expect, it } from 'vitest';
import { isOpsMember, OPS_GROUP, OPS_GROUPS } from '$lib/server/auth/ops-authz';

describe('#820 ops-authz', () => {
	describe('OPS_GROUP 定数', () => {
		it('Cognito group 名と一致する "ops"', () => {
			expect(OPS_GROUP).toBe('ops');
		});

		it('OPS_GROUPS に OPS_GROUP が含まれる', () => {
			expect(OPS_GROUPS).toContain(OPS_GROUP);
		});
	});

	describe('isOpsMember', () => {
		it('identity=null は false', () => {
			expect(isOpsMember(null)).toBe(false);
		});

		it('local identity は false', () => {
			expect(isOpsMember({ type: 'local' })).toBe(false);
		});

		it('cognito identity で groups 未提供は false', () => {
			expect(
				isOpsMember({
					type: 'cognito',
					userId: 'u-1',
					email: 'a@b.com',
				}),
			).toBe(false);
		});

		it('cognito identity で groups=[] は false', () => {
			expect(
				isOpsMember({
					type: 'cognito',
					userId: 'u-1',
					email: 'a@b.com',
					groups: [],
				}),
			).toBe(false);
		});

		it('cognito identity で groups=["ops"] は true', () => {
			expect(
				isOpsMember({
					type: 'cognito',
					userId: 'u-ops-1',
					email: 'ops@example.com',
					groups: ['ops'],
				}),
			).toBe(true);
		});

		it('cognito identity で groups=["ops", "other"] は true', () => {
			expect(
				isOpsMember({
					type: 'cognito',
					userId: 'u-ops-2',
					email: 'ops@example.com',
					groups: ['ops', 'other'],
				}),
			).toBe(true);
		});

		it('cognito identity で ops 以外の group のみは false', () => {
			expect(
				isOpsMember({
					type: 'cognito',
					userId: 'u-1',
					email: 'a@b.com',
					groups: ['random', 'admin'],
				}),
			).toBe(false);
		});
	});
});
