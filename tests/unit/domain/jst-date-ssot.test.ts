// tests/unit/domain/jst-date-ssot.test.ts
// #4015 — date-utils.ts の JST SSOT ヘルパが「壊れる窓」で正しい暦日を返すことを固定する。
//
// ## 壊れる窓
//
// 本番 runtime のプロセス TZ は Lambda / CI = UTC、NUC セルフホスト = JST。
// ローカル TZ getter (`getFullYear` / `getMonth` / `getDate` / `getDay`) を実時刻に対して
// 使うと、**UTC 15:00〜24:00 = JST 翌日 00:00〜09:00** の 9 時間だけ暦日が 1 日前になる。
// #4003 (週次チャレンジ消失) はこの窓で起きた。
//
// ## テストの書き方 (#4051 の教訓)
//
// 期待値は被検証対象と同じ関数から作らない。**固定文字列 / 固定数値を直書き**し、
// 入力は `vi.setSystemTime()` で TZ に依らない ISO (`...Z`) を与える。
// これにより「実装が変わっても期待値が一緒にずれる」ことが起きない。
//
// 本 test 自体はプロセス TZ に依存しない (SSOT 関数が TZ 非依存であることの表明でもある)。
// 旧実装 (ローカル getter) は TZ=UTC で実行すると W2 / D2 / M2 / Y2 が落ちる。

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addDaysJST,
	isInJstMonth,
	jstDayOfWeek,
	jstYearMonth,
	monthEndJST,
	monthEndOfKey,
	monthKeyJST,
	monthStartJST,
	prevDateJST,
	shiftMonthKey,
	todayDateJST,
	weekEndJST,
	weekStartJST,
} from '../../../src/lib/domain/date-utils';

afterEach(() => {
	vi.useRealTimers();
});

/** 指定 UTC 時刻に固定する。TZ の影響を受けない ISO 文字列で与える。 */
function freezeUtc(iso: string): void {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(iso));
}

describe('#4015 jstDayOfWeek — 曜日を JST 基準で決める', () => {
	// 2026-07-26 は日曜、2026-07-27 は月曜。UTC 日曜 15:00 = JST 月曜 00:00 が境界。
	it('[D1] UTC 日曜 14:59 (JST 日曜 23:59) → 0 (日曜)', () => {
		freezeUtc('2026-07-26T14:59:00Z');
		expect(jstDayOfWeek()).toBe(0);
	});

	// ここが旧実装 (`new Date().getDay()`) の欠陥そのもの。UTC ではまだ日曜のため 0 を返す。
	it('[D2] UTC 日曜 15:00 (JST 月曜 00:00) → 1 (月曜)', () => {
		freezeUtc('2026-07-26T15:00:00Z');
		expect(jstDayOfWeek()).toBe(1);
	});

	it('[D3] UTC 日曜 23:59 (JST 月曜 08:59) → 1 (窓の内側)', () => {
		freezeUtc('2026-07-26T23:59:00Z');
		expect(jstDayOfWeek()).toBe(1);
	});

	it('[D4] UTC 月曜 00:00 (JST 月曜 09:00) → 1 (窓を抜けても不変)', () => {
		freezeUtc('2026-07-27T00:00:00Z');
		expect(jstDayOfWeek()).toBe(1);
	});

	it('[D5] 引数で渡した瞬間にも適用される (土曜 → 日曜の境界)', () => {
		// UTC 土曜 15:00 = JST 日曜 00:00
		expect(jstDayOfWeek(new Date('2026-07-25T14:59:00Z'))).toBe(6);
		expect(jstDayOfWeek(new Date('2026-07-25T15:00:00Z'))).toBe(0);
	});
});

describe('#4015 weekEndJST — 週末 (日曜) を JST 基準で決める', () => {
	it('[WE1] UTC 日曜 14:59 (JST 日曜 23:59) → 週末は当日 07-26', () => {
		freezeUtc('2026-07-26T14:59:00Z');
		expect(weekEndJST()).toBe('2026-07-26');
	});

	it('[WE2] UTC 日曜 15:00 (JST 月曜 00:00) → 週が切り替わり週末は 08-02', () => {
		freezeUtc('2026-07-26T15:00:00Z');
		expect(weekEndJST()).toBe('2026-08-02');
	});

	it('[WE3] weekStartJST と 6 日ぴったり離れている (固定値で確認)', () => {
		freezeUtc('2026-07-29T00:00:00Z'); // JST 水曜 09:00
		expect(weekStartJST()).toBe('2026-07-27');
		expect(weekEndJST()).toBe('2026-08-02');
	});
});

describe('#4015 addDaysJST / prevDateJST — 暦日文字列の加減算', () => {
	it('[A1] 月をまたぐ +1 日', () => {
		expect(addDaysJST('2026-07-31', 1)).toBe('2026-08-01');
	});

	it('[A2] 年をまたぐ +1 日', () => {
		expect(addDaysJST('2026-12-31', 1)).toBe('2027-01-01');
	});

	it('[A3] 負値で過去へ (月をまたぐ)', () => {
		expect(addDaysJST('2026-03-01', -1)).toBe('2026-02-28');
	});

	it('[A4] うるう年の 2/29 を正しく通る', () => {
		expect(addDaysJST('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDaysJST('2028-03-01', -1)).toBe('2028-02-29');
	});

	it('[A5] 0 日加算は同じ日', () => {
		expect(addDaysJST('2026-07-27', 0)).toBe('2026-07-27');
	});

	it('[A6] prevDateJST は addDaysJST(-1) と同じ結果 (固定値で確認)', () => {
		expect(prevDateJST('2026-01-01')).toBe('2025-12-31');
	});
});

describe('#4015 jstYearMonth / monthKeyJST — 年月を JST 基準で決める', () => {
	it('[M1] UTC 月末 14:59 (JST 月末 23:59) → まだ 7 月', () => {
		freezeUtc('2026-07-31T14:59:00Z');
		expect(jstYearMonth()).toEqual({ year: 2026, month: 7 });
		expect(monthKeyJST()).toBe('2026-07');
	});

	// 旧実装 (`now.getMonth() + 1`) はここで 7 を返し、月次集計が前月に載っていた。
	it('[M2] UTC 月末 15:00 (JST 翌月 1 日 00:00) → 8 月に切り替わる', () => {
		freezeUtc('2026-07-31T15:00:00Z');
		expect(jstYearMonth()).toEqual({ year: 2026, month: 8 });
		expect(monthKeyJST()).toBe('2026-08');
	});

	it('[Y1] UTC 12/31 14:59 (JST 12/31 23:59) → まだ 2026 年', () => {
		freezeUtc('2026-12-31T14:59:00Z');
		expect(jstYearMonth()).toEqual({ year: 2026, month: 12 });
	});

	// 旧実装はここで 2026 を返していた (challenge-set-import-service の JSDoc が警告していた形)。
	it('[Y2] UTC 12/31 15:00 (JST 1/1 00:00) → 2027 年に切り替わる', () => {
		freezeUtc('2026-12-31T15:00:00Z');
		expect(jstYearMonth()).toEqual({ year: 2027, month: 1 });
		expect(monthKeyJST()).toBe('2027-01');
	});
});

describe('#4015 monthStartJST / monthEndJST / monthEndOfKey — 月境界', () => {
	it('[MS1] UTC 月末 15:00 (JST 翌月 1 日) の月初は翌月 1 日', () => {
		freezeUtc('2026-07-31T15:00:00Z');
		expect(monthStartJST()).toBe('2026-08-01');
		expect(monthEndJST()).toBe('2026-08-31');
	});

	it('[MS2] 30 日 / 31 日 / うるう年 2 月の末日 (固定値)', () => {
		expect(monthEndOfKey('2026-04')).toBe('2026-04-30');
		expect(monthEndOfKey('2026-07')).toBe('2026-07-31');
		expect(monthEndOfKey('2026-02')).toBe('2026-02-28');
		expect(monthEndOfKey('2028-02')).toBe('2028-02-29');
	});
});

describe('#4015 shiftMonthKey — 月キーの前後移動', () => {
	it('[S1] 年をまたいで戻る', () => {
		expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
		expect(shiftMonthKey('2026-01', -13)).toBe('2024-12');
	});

	it('[S2] 年をまたいで進む', () => {
		expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
	});

	it('[S3] 0 は不変', () => {
		expect(shiftMonthKey('2026-07', 0)).toBe('2026-07');
	});
});

describe('#4015 isInJstMonth — UTC timestamp を JST 月で判定する', () => {
	// createdAt.startsWith('2026-08') 方式では [I2] が前月扱いで落ちる (admin/points の欠陥)。
	it('[I1] UTC 7/31 14:59 (JST 7/31) は 2026-07 に属する', () => {
		expect(isInJstMonth('2026-07-31T14:59:00.000Z', '2026-07')).toBe(true);
		expect(isInJstMonth('2026-07-31T14:59:00.000Z', '2026-08')).toBe(false);
	});

	it('[I2] UTC 7/31 15:00 (JST 8/1 00:00) は 2026-08 に属する', () => {
		expect(isInJstMonth('2026-07-31T15:00:00.000Z', '2026-08')).toBe(true);
		expect(isInJstMonth('2026-07-31T15:00:00.000Z', '2026-07')).toBe(false);
	});

	it('[I3] null / 空文字 / 不正値は false (例外を投げない)', () => {
		expect(isInJstMonth(null, '2026-07')).toBe(false);
		expect(isInJstMonth(undefined, '2026-07')).toBe(false);
		expect(isInJstMonth('', '2026-07')).toBe(false);
		expect(isInJstMonth('not-a-date', '2026-07')).toBe(false);
	});
});

describe('#4015 todayDateJST と各ヘルパの基準日が一致する', () => {
	it('[C1] 窓の内側でも「今日」「週頭」「月初」が同じ暦日系を見ている', () => {
		freezeUtc('2026-07-31T15:30:00Z'); // JST 2026-08-01 (土) 00:30
		expect(todayDateJST()).toBe('2026-08-01');
		expect(monthStartJST()).toBe('2026-08-01');
		expect(jstDayOfWeek()).toBe(6); // 2026-08-01 は土曜
		expect(weekStartJST()).toBe('2026-07-27');
		expect(weekEndJST()).toBe('2026-08-02');
	});
});
