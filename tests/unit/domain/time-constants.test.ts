// tests/unit/domain/time-constants.test.ts
// 時間単位変換定数の正しさを検証 (#973)

import { describe, expect, it } from 'vitest';
import {
	MS_PER_DAY,
	MS_PER_HOUR,
	MS_PER_MINUTE,
	MS_PER_SECOND,
	SECONDS_PER_DAY,
} from '../../../src/lib/domain/constants/time';

describe('time constants', () => {
	it('MS_PER_SECOND は 1000', () => {
		expect(MS_PER_SECOND).toBe(1000);
	});

	it('MS_PER_MINUTE は 60,000', () => {
		expect(MS_PER_MINUTE).toBe(60_000);
	});

	it('MS_PER_HOUR は 3,600,000', () => {
		expect(MS_PER_HOUR).toBe(3_600_000);
	});

	it('MS_PER_DAY は 86,400,000', () => {
		expect(MS_PER_DAY).toBe(86_400_000);
	});

	it('SECONDS_PER_DAY は 86,400', () => {
		expect(SECONDS_PER_DAY).toBe(86_400);
	});

	it('MS_PER_DAY === 24 * 60 * 60 * 1000', () => {
		expect(MS_PER_DAY).toBe(24 * 60 * 60 * 1000);
	});

	it('SECONDS_PER_DAY === 24 * 60 * 60', () => {
		expect(SECONDS_PER_DAY).toBe(24 * 60 * 60);
	});

	it('定数間の整合性: MS_PER_DAY === SECONDS_PER_DAY * MS_PER_SECOND', () => {
		expect(MS_PER_DAY).toBe(SECONDS_PER_DAY * MS_PER_SECOND);
	});
});
