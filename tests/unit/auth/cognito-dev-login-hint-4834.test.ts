// tests/unit/auth/cognito-dev-login-hint-4834.test.ts
//
// /auth/login (cognito-dev のみ) の「テスト用アカウント」案内は DEV_USERS (SSOT) から導出する。
// literal 3 行と同じ 3 role / 同じ順 / SSOT と同じ値であることを固定する。
import { describe, expect, it } from 'vitest';
import {
	DEV_USERS,
	listDevLoginAccounts,
} from '../../../src/lib/server/auth/providers/cognito-dev';

describe('listDevLoginAccounts (#4834)', () => {
	it('owner / parent / child を同一 tenant からこの順で 3 件返し、値は DEV_USERS と一致する', () => {
		const list = listDevLoginAccounts();
		expect(list.map((a) => a.role)).toEqual(['owner', 'parent', 'child']);
		for (const a of list) {
			const ssot = DEV_USERS.find((u) => u.email === a.email);
			expect(ssot?.role).toBe(a.role);
			expect(ssot?.password).toBe(a.password);
			expect(ssot?.tenantId).toBe(DEV_USERS[0]?.tenantId);
		}
	});
});
