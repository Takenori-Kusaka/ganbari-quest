// tests/unit/domain/child-age-clamp-4718.test.ts (#4718 QM)
//
// 誕生日から導く年齢の丸めが setup と admin で二重実装になっており、setup 側だけ
// 丸めが無かった。19 歳以上になる誕生日を入れると「年齢は0〜18で入力してください」が返るが、
// その年齢欄は誕生日を入れた時点で disabled になっていて直せない = 初回セットアップの行き止まり。

import { describe, expect, it } from 'vitest';
import { CHILD_AGE_MAX, childAgeFromBirthDate } from '../../../src/lib/domain/child-age';
import { calculateAgeFromBirthDate } from '../../../src/lib/domain/date-utils';

const TODAY = '2026-09-02';

describe('#4718 誕生日 → 登録年齢の丸め (SSOT)', () => {
	it('上限を超える誕生日は CHILD_AGE_MAX に丸める (行き止まりを作らない)', () => {
		// 1990 年生まれ = 36 歳。生値のままだと age > 18 で reject され、
		// 直せない年齢欄を指すエラーになる。
		expect(calculateAgeFromBirthDate('1990-05-05', TODAY)).toBeGreaterThan(CHILD_AGE_MAX);
		expect(childAgeFromBirthDate('1990-05-05', TODAY)).toBe(CHILD_AGE_MAX);
	});

	it('上限以下はそのまま (丸めが通常値を歪めない)', () => {
		for (const [birth, expected] of [
			['2018-05-05', 8],
			['2008-09-02', 18],
			['2026-01-01', 0],
		] as const) {
			expect(childAgeFromBirthDate(birth, TODAY), birth).toBe(expected);
		}
	});

	it('丸めた結果は登録可能な値域 (0〜CHILD_AGE_MAX) に必ず収まる', () => {
		for (const birth of ['1970-01-01', '2000-12-31', '2026-09-02']) {
			const age = childAgeFromBirthDate(birth, TODAY);
			expect(age, birth).toBeGreaterThanOrEqual(0);
			expect(age, birth).toBeLessThanOrEqual(CHILD_AGE_MAX);
		}
	});
});
