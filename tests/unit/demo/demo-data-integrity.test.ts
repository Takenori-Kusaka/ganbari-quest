import { describe, expect, it } from 'vitest';
import { getDefaultUiMode } from '../../../src/lib/domain/validation/age-tier';
import { DEMO_CHILDREN } from '../../../src/lib/server/demo/demo-data';

describe('demo data integrity (#562)', () => {
	describe('DEMO_CHILDREN', () => {
		it.each(DEMO_CHILDREN)(
			'$nickname (age $age) の uiMode が getDefaultUiMode(age) と一致する',
			(child) => {
				const expected = getDefaultUiMode(child.age);
				expect(child.uiMode).toBe(expected);
			},
		);

		it('子どもの年齢と区分が新仕様 #537 と整合している', () => {
			const summary = DEMO_CHILDREN.map((c) => ({
				nickname: c.nickname,
				age: c.age,
				uiMode: c.uiMode,
				expected: getDefaultUiMode(c.age),
			}));
			const mismatches = summary.filter((s) => s.uiMode !== s.expected);
			expect(mismatches).toEqual([]);
		});
	});
});
