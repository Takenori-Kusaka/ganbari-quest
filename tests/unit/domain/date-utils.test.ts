import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	daysBetweenJST,
	daysInMonthOfKey,
	formatJSTDate,
	formatJSTDateTime,
	jstDateOfIso,
	jstDateToInstant,
	jstMinuteOfDay,
	monthKeyOfDate,
	prevDateJST,
	todayDateJST,
	toJSTDateString,
	utcMonthKey,
	weekEndOfDateJST,
	weekStartOfDateJST,
} from '$lib/domain/date-utils';

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

	describe('formatJSTDate', () => {
		it('YYYY-MM-DD を年月日形式に変換', () => {
			expect(formatJSTDate('2026-04-13')).toBe('2026年4月13日');
		});

		it('1月1日のゼロ埋めなし', () => {
			expect(formatJSTDate('2026-01-01')).toBe('2026年1月1日');
		});
	});

	describe('formatJSTDateTime', () => {
		it('Date を JST 日時文字列に変換', () => {
			// UTC 2026-04-13 01:00 → JST 2026-04-13 10:00
			const date = new Date('2026-04-13T01:00:00Z');
			const result = formatJSTDateTime(date);
			// toLocaleString のフォーマットは実行環境依存だが、日本語で年月日時分が含まれること
			expect(result).toContain('2026');
			expect(result).toContain('4');
			expect(result).toContain('13');
		});
	});

	describe('todayDateJST vs UTC の差異（#966 回帰防止）', () => {
		it('0:00〜9:00 JST (= 前日15:00〜当日0:00 UTC) で todayDateJST は JST の今日を返す', () => {
			vi.useFakeTimers();
			// JST 2026-04-14 03:00 = UTC 2026-04-13 18:00
			vi.setSystemTime(new Date('2026-04-13T18:00:00Z'));
			const jstToday = todayDateJST();
			const utcToday = new Date().toISOString().slice(0, 10);

			// JST は 4/14 だが UTC は 4/13 → 不一致が発生する時間帯
			expect(jstToday).toBe('2026-04-14');
			expect(utcToday).toBe('2026-04-13');
			expect(jstToday).not.toBe(utcToday);
		});

		it('9:00 JST 以降 (= 当日0:00 UTC 以降) では JST と UTC の日付は一致する', () => {
			vi.useFakeTimers();
			// JST 2026-04-14 12:00 = UTC 2026-04-14 03:00
			vi.setSystemTime(new Date('2026-04-14T03:00:00Z'));
			const jstToday = todayDateJST();
			const utcToday = new Date().toISOString().slice(0, 10);

			expect(jstToday).toBe('2026-04-14');
			expect(utcToday).toBe('2026-04-14');
		});
	});
	// #4120: 暦を返す関数を date-utils 1 本に集約したことで増えた入口。
	// いずれも「JST 00:00〜09:00 の 9 時間」で UTC 実装と答えが割れる点を assert する。
	describe('#4120 暦 SSOT の追加入口', () => {
		it('jstDateToInstant は暦日を往復できる (UTC 深夜 = JST 09:00)', () => {
			expect(toJSTDateString(jstDateToInstant('2026-08-01'))).toBe('2026-08-01');
			expect(jstDateToInstant('2026-08-01').toISOString()).toBe('2026-08-01T00:00:00.000Z');
		});

		it('jstDateOfIso は ISO timestamp の JST 暦日を返す (UTC 暦日と割れる時間帯)', () => {
			// UTC 2026-07-31 15:10 = JST 2026-08-01 00:10
			expect(jstDateOfIso('2026-07-31T15:10:00.000Z')).toBe('2026-08-01');
			// 素朴な slice(0, 10) は UTC 暦日 = 前日を返す (置換前の実装)
			expect('2026-07-31T15:10:00.000Z'.slice(0, 10)).toBe('2026-07-31');
			expect(jstDateOfIso('2026-08-01T06:00:00.000Z')).toBe('2026-08-01');
		});

		it('jstMinuteOfDay は JST の 0:00 からの経過分を返す', () => {
			expect(jstMinuteOfDay(new Date('2026-07-31T15:10:00Z'))).toBe(10); // JST 00:10
			expect(jstMinuteOfDay(new Date('2026-08-01T12:30:00Z'))).toBe(21 * 60 + 30); // JST 21:30
		});

		it('weekStartOfDateJST / weekEndOfDateJST は月曜始まり・日曜終わり', () => {
			// 2026-08-01 は土曜
			expect(weekStartOfDateJST('2026-08-01')).toBe('2026-07-27');
			expect(weekEndOfDateJST('2026-08-01')).toBe('2026-08-02');
			// 日曜は「その週」の月曜まで 6 日戻る
			expect(weekStartOfDateJST('2026-08-02')).toBe('2026-07-27');
			expect(weekEndOfDateJST('2026-08-02')).toBe('2026-08-02');
			// 月曜はその日自身
			expect(weekStartOfDateJST('2026-07-27')).toBe('2026-07-27');
		});

		it('monthKeyOfDate / daysInMonthOfKey (うるう年含む)', () => {
			expect(monthKeyOfDate('2026-08-01')).toBe('2026-08');
			expect(daysInMonthOfKey('2026-02')).toBe(28);
			expect(daysInMonthOfKey('2024-02')).toBe(29); // うるう年
			expect(daysInMonthOfKey('2026-04')).toBe(30);
			expect(daysInMonthOfKey('2026-12')).toBe(31);
		});

		it('daysBetweenJST は暦日 2 点間の日数差 (月・年またぎ)', () => {
			expect(daysBetweenJST('2026-08-01', '2026-08-08')).toBe(7);
			expect(daysBetweenJST('2026-08-08', '2026-08-01')).toBe(-7);
			expect(daysBetweenJST('2026-02-28', '2026-03-01')).toBe(1);
			expect(daysBetweenJST('2025-12-31', '2026-01-01')).toBe(1);
		});

		it('utcMonthKey は UTC 基準 (ops 集計の鍵が ISO UTC 由来のため JST と割れてよい)', () => {
			// UTC 2026-07-31 15:00 = JST 2026-08-01 00:00
			const d = new Date('2026-07-31T15:00:00Z');
			expect(utcMonthKey(d)).toBe('2026-07');
			expect(toJSTDateString(d).slice(0, 7)).toBe('2026-08');
		});
	});
});
