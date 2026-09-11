// tests/unit/services/weekly-evaluation-week-boundary.test.ts
// #4722: 週次評価の対象週は「直前に**完了した**週」であることを固定する。
//
// 実害: 旧実装は当日が日曜のときだけ `lastSunday = 今日` としていたため、子供が日曜に `/status` を
// 開くと **まだ終わっていない今週** (月〜その瞬間) で評価が確定し、child × weekStart で 1 回しか
// 評価しないため **日曜の残りの活動が永久に評価へ入らなかった**。土曜 / 月曜に開けば前週が対象で
// 正しいという、開いた曜日で結果が変わる状態だった。

import { describe, expect, it } from 'vitest';
import { getWeekRange } from '../../../src/lib/server/services/evaluation-service';

/** JST 12:00 の Date を作る (UTC 03:00。JST 暦日が日付境界でぶれない時刻)。 */
function jstNoon(dateStr: string): Date {
	return new Date(`${dateStr}T03:00:00.000Z`);
}

describe('#4722 getWeekRange は常に完了済みの週を返す', () => {
	it.each([
		// [開いた日 (JST), 曜日, 期待 weekStart, 期待 weekEnd]
		['2026-08-10', '月', '2026-08-03', '2026-08-09'],
		['2026-08-12', '水', '2026-08-03', '2026-08-09'],
		['2026-08-15', '土', '2026-08-03', '2026-08-09'],
		// #4722 本丸: 日曜に開いても「今週」ではなく先週 (8/3-8/9) を返す
		['2026-08-16', '日', '2026-08-03', '2026-08-09'],
	])('%s (%s) に開いても対象週は %s 〜 %s', (day, _dow, weekStart, weekEnd) => {
		expect(getWeekRange(jstNoon(day))).toEqual({ weekStart, weekEnd });
	});

	it('日曜と翌月曜で対象週が同じ = 日曜に開いた人だけ 1 週分を失わない', () => {
		const sunday = getWeekRange(jstNoon('2026-08-16'));
		const monday = getWeekRange(jstNoon('2026-08-17'));
		// 旧実装は日曜 = {8/10, 8/16} を確定させてしまい、翌週の評価 (8/10-8/16) が
		// 「評価済み」として skip されるため日曜の活動が反映されなかった。
		expect(sunday).toEqual({ weekStart: '2026-08-03', weekEnd: '2026-08-09' });
		expect(monday).toEqual({ weekStart: '2026-08-10', weekEnd: '2026-08-16' });
		expect(sunday.weekEnd < monday.weekStart).toBe(true);
	});

	it('週の対象範囲は常に月曜〜日曜の 7 日間', () => {
		for (const day of ['2026-08-10', '2026-08-13', '2026-08-16', '2026-09-01']) {
			const { weekStart, weekEnd } = getWeekRange(jstNoon(day));
			const days =
				(Date.parse(`${weekEnd}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000;
			expect(days).toBe(6);
			// weekStart は月曜 (UTC 深夜として解釈しても曜日は不変)
			expect(new Date(`${weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
			expect(new Date(`${weekEnd}T00:00:00Z`).getUTCDay()).toBe(0);
		}
	});
});
