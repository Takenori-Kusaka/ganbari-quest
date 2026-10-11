// #5049: DB ドライバのエラーを `Failed query: <SQL>` だけで残すと原因が読めない。
// Drizzle は原因を `cause` に入れるので、describeError が cause (SQLSTATE / constraint) まで出すことを固定する。

import { describe, expect, it } from 'vitest';
import { describeError } from '../../../src/lib/server/describe-error';

describe('describeError (#5049)', () => {
	it('Drizzle の包みエラーから cause の SQLSTATE と constraint を取り出す', () => {
		const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
			code: '23505',
			constraint: 'memberships_owner_guard_unique',
		});
		const wrapped = new Error('Failed query: INSERT INTO memberships ...', { cause: driver });

		const text = describeError(wrapped);

		expect(text).toContain('Failed query: INSERT INTO memberships');
		expect(text).toContain('duplicate key value violates unique constraint');
		expect(text).toContain('code=23505');
		expect(text).toContain('constraint=memberships_owner_guard_unique');
	});

	it('cause が無ければ message だけ', () => {
		expect(describeError(new Error('boom'))).toBe('boom');
	});

	it('Error 以外は文字列化する', () => {
		expect(describeError('plain')).toBe('plain');
	});

	it('cause が循環していても止まる', () => {
		const a = new Error('a');
		const b = new Error('b', { cause: a });
		(a as { cause?: unknown }).cause = b;

		expect(() => describeError(a)).not.toThrow();
	});
});
