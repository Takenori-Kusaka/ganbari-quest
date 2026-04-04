import { afterEach, describe, expect, it, vi } from 'vitest';
import { prevDateJST, todayDateJST, toJSTDateString } from '$lib/domain/date-utils';

describe('date-utils', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	describe('toJSTDateString', () => {
		it('UTC午前0時はJSTでは同日の9時', () => {
			const utc = new Date('2026-03-06T00:00:00Z');
			expect(toJSTDateString(utc)).toBe('2026-03-06');
		});

		it('UTC 15:00 はJSTで翌日の0:00', () => {
			const utc = new Date('2026-03-06T15:00:00Z');
			expect(toJSTDateString(utc)).toBe('2026-03-07');
		});

		it('UTC 14:59 はJSTでまだ同日の23:59', () => {
			const utc = new Date('2026-03-06T14:59:00Z');
			expect(toJSTDateString(utc)).toBe('2026-03-06');
		});

		it('年またぎ: UTC 12/31 15:00 → JST 1/1', () => {
			const utc = new Date('2025-12-31T15:00:00Z');
			expect(toJSTDateString(utc)).toBe('2026-01-01');
		});
	});

	describe('todayDateJST', () => {
		it('JST深夜2時(=UTC前日17時)でもJSTの今日を返す', () => {
			// JST 2026-03-06 02:00 = UTC 2026-03-05 17:00
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-03-05T17:00:00Z'));
			expect(todayDateJST()).toBe('2026-03-06');
		});

		it('JST午後11時(=UTC 14:00)は同日を返す', () => {
			// JST 2026-03-06 23:00 = UTC 2026-03-06 14:00
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-03-06T14:00:00Z'));
			expect(todayDateJST()).toBe('2026-03-06');
		});
	});

	describe('prevDateJST', () => {
		it('前日を返す', () => {
			expect(prevDateJST('2026-03-06')).toBe('2026-03-05');
		});

		it('月をまたぐ', () => {
			expect(prevDateJST('2026-03-01')).toBe('2026-02-28');
		});

		it('年をまたぐ', () => {
			expect(prevDateJST('2026-01-01')).toBe('2025-12-31');
		});
	});
});
