/**
 * #2297 (EPIC #2294 ③) / #2369 (EPIC #2362 P3): challenge-set 日付展開ヘルパー
 * `expandChallengeSetDates` の unit テスト。
 *
 * 旧 `+page.server.ts` の `_expandChallengeSetDates` は #2369 で
 * `src/lib/server/services/challenge-set-import-service.ts` に集約 (ADR-0052)。
 *
 * - 今年の monthDay が未来日付なら今年扱い
 * - 今年の monthDay が過去日付なら来年扱い
 * - durationDays に応じて startDate が endDate - (N-1) 日
 * - YYYY-MM-DD 形式で返る
 */

import { describe, expect, it } from 'vitest';
import { expandChallengeSetDates } from '../../../src/lib/server/services/challenge-set-import-service';

describe('#2297 / #2369 expandChallengeSetDates', () => {
	it('未来日付なら今年の同月日を endDate に展開', () => {
		// 2026/01/01 時点で 12-25 → 2026/12/25
		const today = new Date(Date.UTC(2026, 0, 1));
		const result = expandChallengeSetDates('12-25', 10, today);
		expect(result.endDate).toBe('2026-12-25');
		// startDate = endDate - 9 日 = 2026-12-16
		expect(result.startDate).toBe('2026-12-16');
	});

	it('過去日付なら来年扱い', () => {
		// 2026/05/19 時点で 03-03 (ひな祭り、既に過ぎてる) → 2027/03/03
		const today = new Date(Date.UTC(2026, 4, 19));
		const result = expandChallengeSetDates('03-03', 3, today);
		expect(result.endDate).toBe('2027-03-03');
		expect(result.startDate).toBe('2027-03-01');
	});

	it('当日 monthDay は今年扱い (>= 比較)', () => {
		// 2026/03/03 時点で 03-03 → 2026/03/03
		const today = new Date(Date.UTC(2026, 2, 3));
		const result = expandChallengeSetDates('03-03', 1, today);
		expect(result.endDate).toBe('2026-03-03');
		expect(result.startDate).toBe('2026-03-03');
	});

	it('durationDays=1 なら startDate = endDate', () => {
		const today = new Date(Date.UTC(2026, 0, 1));
		const result = expandChallengeSetDates('07-07', 1, today);
		expect(result.endDate).toBe('2026-07-07');
		expect(result.startDate).toBe('2026-07-07');
	});

	it('durationDays=42 (夏休み読書記録) が正しく 41 日遡る', () => {
		// endDate 2026-08-31 - 41 = 2026-07-21
		const today = new Date(Date.UTC(2026, 0, 1));
		const result = expandChallengeSetDates('08-31', 42, today);
		expect(result.endDate).toBe('2026-08-31');
		expect(result.startDate).toBe('2026-07-21');
	});

	it('月をまたぐ duration が正しく展開', () => {
		// endDate 2026-01-07 - 6 = 2025-12-... ? いや、未来日付として扱われ次の年の起点になる
		// 2026/01/01 時点で 01-07 → 2026-01-07 (未来) → start = 2026-01-01
		const today = new Date(Date.UTC(2026, 0, 1));
		const result = expandChallengeSetDates('01-07', 7, today);
		expect(result.endDate).toBe('2026-01-07');
		expect(result.startDate).toBe('2026-01-01');
	});

	it('不正な monthDay フォーマットで Error', () => {
		expect(() => expandChallengeSetDates('invalid', 7, new Date())).toThrow();
		expect(() => expandChallengeSetDates('', 7, new Date())).toThrow();
	});
});
