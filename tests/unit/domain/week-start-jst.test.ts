// tests/unit/domain/week-start-jst.test.ts
// #4003 / #4020 — 週頭と「今日」の TZ 基準を JST に固定する。
//
// ## 何を守るか
//
// 週次チャレンジは **書き込み側が `getWeekStart()` で週頭を決め、読み出し側が
// `todayDateJST()` で active 判定する**。両者の TZ 基準がずれると、ずれた時間帯だけ
// 「その週のデータが存在しない」ことになる。
//
// 旧実装は `getWeekStart()` が `new Date()` のローカル日付要素を使っていたため、
// プロセス TZ が UTC (CI runner / 本番 Lambda) のとき **UTC 日曜 15:00〜24:00 =
// JST 月曜 00:00〜09:00 の 9 時間**だけ週がずれ、子供ホームの週次チャレンジバッジが
// 全カテゴリで消えていた (#4003)。
//
// ## なぜ e2e ではなくここで固定するか
//
// e2e (`child-challenge-card-badge.spec.ts`) はこの窓に入った時だけ落ちる。つまり
// **実行時刻に依存して緑にも赤にもなる**ので、回帰の検出手段として信頼できない
// (実際 #4003 は「日曜 UTC 夜に回した run だけが落ちた」形で表面化した)。
// 時刻を固定できる層で境界そのものを assert する。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayDateJST, weekStartJST } from '../../../src/lib/domain/date-utils';

afterEach(() => {
	vi.useRealTimers();
});

/** 指定 UTC 時刻に固定する。TZ の影響を受けない ISO 文字列で与える。 */
function freezeUtc(iso: string): void {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(iso));
}

describe('#4003 weekStartJST — 週頭を JST 基準で決める', () => {
	// 2026-07-26(日) / 2026-07-27(月) 周辺を使う。
	// UTC 日曜 15:00 = JST 月曜 00:00 が境界。
	it('[W1] UTC 日曜 14:59 (JST 日曜 23:59) → その週の月曜は 07-20', () => {
		freezeUtc('2026-07-26T14:59:00Z');
		expect(weekStartJST()).toBe('2026-07-20');
	});

	// **ここが旧実装の欠陥そのもの。** UTC ではまだ日曜なので、ローカル日付要素を使うと
	// 前週月曜 (07-20) を返してしまう。JST では既に月曜なので 07-27 でなければならない。
	it('[W2] UTC 日曜 15:00 (JST 月曜 00:00) → 週が切り替わり 07-27', () => {
		freezeUtc('2026-07-26T15:00:00Z');
		expect(weekStartJST()).toBe('2026-07-27');
	});

	it('[W3] UTC 日曜 23:59 (JST 月曜 08:59) → まだ 07-27 (窓の内側)', () => {
		freezeUtc('2026-07-26T23:59:00Z');
		expect(weekStartJST()).toBe('2026-07-27');
	});

	it('[W4] UTC 月曜 00:00 (JST 月曜 09:00) → 07-27 のまま (窓を抜けても不変)', () => {
		freezeUtc('2026-07-27T00:00:00Z');
		expect(weekStartJST()).toBe('2026-07-27');
	});

	// 書き込み (weekStartJST) と読み出し (todayDateJST) が同じ暦日を見ていることの固定。
	// これが崩れると `startDate <= today <= endDate` の active 判定が壊れる。
	it('[W5] 窓の内側で weekStart <= todayDateJST が成り立つ (active 判定の前提)', () => {
		freezeUtc('2026-07-26T15:00:00Z'); // JST 月曜 00:00
		const start = weekStartJST();
		const today = todayDateJST();
		expect(today).toBe('2026-07-27');
		expect(start <= today).toBe(true);
		// 週の終端 (日曜) は start + 6 日。today がその範囲に入ること。
		const end = new Date(`${start}T00:00:00Z`);
		end.setUTCDate(end.getUTCDate() + 6);
		expect(today <= end.toISOString().slice(0, 10)).toBe(true);
	});

	it('[W6] 各曜日で正しい月曜を返す (JST 基準、UTC 深夜 = JST 午前 9 時で確認)', () => {
		// UTC 00:00 は JST 09:00 なので暦日は UTC と同じ。曜日ロジックだけを見る。
		const cases: [string, string][] = [
			['2026-07-27T00:00:00Z', '2026-07-27'], // 月
			['2026-07-28T00:00:00Z', '2026-07-27'], // 火
			['2026-07-31T00:00:00Z', '2026-07-27'], // 金
			['2026-08-01T00:00:00Z', '2026-07-27'], // 土
			['2026-08-02T00:00:00Z', '2026-07-27'], // 日 → 前週月曜まで戻る
			['2026-08-03T00:00:00Z', '2026-08-03'], // 翌月曜
		];
		for (const [iso, expected] of cases) {
			freezeUtc(iso);
			expect(weekStartJST(), `${iso} の週頭`).toBe(expected);
			vi.useRealTimers();
		}
	});

	it('[W7] 月またぎ / 年またぎでも UTC 算術で正しく戻る', () => {
		freezeUtc('2026-01-01T00:00:00Z'); // 木
		expect(weekStartJST()).toBe('2025-12-29');
		vi.useRealTimers();
		freezeUtc('2026-03-01T00:00:00Z'); // 日 → 前週月曜
		expect(weekStartJST()).toBe('2026-02-23');
	});

	// 引数を渡した場合も同じ規則であること (既存 callsite は date を渡す形がある)。
	it('[W8] 引数指定でも JST 基準で解釈する', () => {
		expect(weekStartJST(new Date('2026-07-26T15:00:00Z'))).toBe('2026-07-27');
		expect(weekStartJST(new Date('2026-07-26T14:59:00Z'))).toBe('2026-07-20');
	});
});
