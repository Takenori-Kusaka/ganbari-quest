// tests/unit/services/jst-boundary-regression.test.ts
// #4015 — ローカル TZ 日付 getter から JST SSOT へ是正した各所の回帰テスト。
//
// ## 壊れる窓
//
// **UTC 15:00〜24:00 = JST 翌日 00:00〜09:00** の 9 時間。Lambda / CI は UTC 稼働のため、
// この窓でローカル TZ getter を使うと暦日 (月初 / 年始なら月 / 年) が 1 つ前にずれる。
// #4003 (週次チャレンジが毎週 9 時間消えた) と同 class。
//
// ## 書き方 (#4051 の教訓)
//
// 期待値は被検証対象と同じ関数から作らない。**固定文字列を直書き**し、入力は
// `vi.setSystemTime()` に TZ 非依存な `...Z` ISO を与える。旧実装 (ローカル getter) は
// `TZ=UTC` で走らせると本ファイルの境界ケースが落ちる。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFindAllChildren = vi.fn();
const mockGetSetting = vi.fn();
const mockFindActivityLogs = vi.fn();

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
}));
vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));
vi.mock('$lib/server/db/activity-repo', () => ({
	findActivityLogs: (...args: unknown[]) => mockFindActivityLogs(...args),
}));

const mockTrialInsert = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		trialHistory: {
			findLatestByTenant: vi.fn(async () => undefined),
			insert: (...args: unknown[]) => mockTrialInsert(...args),
		},
	}),
}));

import { resolvePresetChallengeDates } from '$lib/data/preset-challenges';
import { getWeekRange } from '$lib/server/services/evaluation-service';
import { getMonthKey } from '$lib/server/services/ops-analytics-service';
import { getCurrentRound } from '$lib/server/services/pmf-survey-service';
import { getMonthlyRanking, getWeeklyRanking } from '$lib/server/services/sibling-ranking-service';
import { startTrial } from '$lib/server/services/trial-service';

/** 指定 UTC 時刻に固定する。TZ の影響を受けない ISO 文字列で与える。 */
function freezeUtc(iso: string): void {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(iso));
}

afterEach(() => {
	vi.useRealTimers();
});

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// evaluation-service.getWeekRange — 週次評価の対象週 (顧客画面: 子ステータス / 週次レポート)
// ---------------------------------------------------------------------------
describe('#4015 evaluation-service.getWeekRange — 対象週が JST 基準', () => {
	// 2026-07-26(日) / 2026-07-27(月)。UTC 日曜 15:00 = JST 月曜 00:00 が境界。
	// #4722: 対象週は「直前に**完了した**週」。日曜はまだ今週が終わっていないので前週を返す
	// (旧契約は当日を含む週を返し、日曜に開いた子の残り時間が永久に評価へ入らなかった)。
	// JST 境界の証明 (#4015) は [E2] との差分が担保する: 同じ UTC 1 分差で週が 1 つ進む。
	it('[E1] UTC 日曜 14:59 (JST 日曜 23:59) → 直前の完了週 07-13〜07-19', () => {
		expect(getWeekRange(new Date('2026-07-26T14:59:00Z'))).toEqual({
			weekStart: '2026-07-13',
			weekEnd: '2026-07-19',
		});
	});

	// 旧実装 (`d.getDay()` + `toISOString()`) は UTC ではまだ日曜のため 07-20〜07-26 を返し、
	// JST 月曜の朝 9 時間だけ「前の週」がもう一度評価対象になっていた。
	it('[E2] UTC 日曜 15:00 (JST 月曜 00:00) → 直前の完了週 07-20〜07-26 のまま', () => {
		expect(getWeekRange(new Date('2026-07-26T15:00:00Z'))).toEqual({
			weekStart: '2026-07-20',
			weekEnd: '2026-07-26',
		});
	});

	it('[E3] UTC 月曜 15:00 (JST 火曜 00:00) → 前週 07-20〜07-26', () => {
		expect(getWeekRange(new Date('2026-07-27T15:00:00Z'))).toEqual({
			weekStart: '2026-07-20',
			weekEnd: '2026-07-26',
		});
	});

	// #4722: 日曜に入っても週は進まない (週が進むのは JST 月曜 00:00)。当日を含む週で確定させると
	// child × weekStart で 1 回しか評価しないため日曜の活動が失われる。
	it('[E4] UTC 土曜 15:00 (JST 日曜 00:00) → 週は進まず直前の完了週 07-20〜07-26', () => {
		expect(getWeekRange(new Date('2026-08-01T15:00:00Z'))).toEqual({
			weekStart: '2026-07-20',
			weekEnd: '2026-07-26',
		});
	});
});

// ---------------------------------------------------------------------------
// sibling-ranking-service — 週次 / 月次ランキングの集計期間 (顧客画面: admin/reports)
// ---------------------------------------------------------------------------
describe('#4015 sibling-ranking-service — 集計期間が JST 基準', () => {
	beforeEach(() => {
		mockGetSetting.mockResolvedValue('true');
		mockFindAllChildren.mockResolvedValue([{ id: 'c1', nickname: 'たろう', uiMode: 'elementary' }]);
		mockFindActivityLogs.mockResolvedValue([]);
	});

	// 旧実装は `new Date().getDay()` + `toISOString()` の混在で、この窓に前週の範囲を返していた。
	it('[R1] UTC 日曜 15:00 (JST 月曜 00:00) → 今週 07-27〜08-02 を集計する', async () => {
		freezeUtc('2026-07-26T15:00:00Z');
		await getWeeklyRanking('tenant1');
		expect(mockFindActivityLogs).toHaveBeenCalledWith('c1', 'tenant1', {
			from: '2026-07-27',
			to: '2026-08-02',
		});
	});

	it('[R2] UTC 日曜 14:59 (JST 日曜 23:59) → まだ 07-20〜07-26', async () => {
		freezeUtc('2026-07-26T14:59:00Z');
		await getWeeklyRanking('tenant1');
		expect(mockFindActivityLogs).toHaveBeenCalledWith('c1', 'tenant1', {
			from: '2026-07-20',
			to: '2026-07-26',
		});
	});

	it('[R3] UTC 月末 15:00 (JST 翌月 1 日 00:00) → 月次は 08-01〜08-31', async () => {
		freezeUtc('2026-07-31T15:00:00Z');
		await getMonthlyRanking('tenant1');
		expect(mockFindActivityLogs).toHaveBeenCalledWith('c1', 'tenant1', {
			from: '2026-08-01',
			to: '2026-08-31',
		});
	});

	it('[R4] UTC 月末 14:59 (JST 月末 23:59) → 月次は 07-01〜07-31', async () => {
		freezeUtc('2026-07-31T14:59:00Z');
		await getMonthlyRanking('tenant1');
		expect(mockFindActivityLogs).toHaveBeenCalledWith('c1', 'tenant1', {
			from: '2026-07-01',
			to: '2026-07-31',
		});
	});
});

// ---------------------------------------------------------------------------
// trial-service.startTrial — トライアル開始 / 終了日 (顧客画面 + プラン判定)
// ---------------------------------------------------------------------------
describe('#4015 trial-service.startTrial — 開始日 / 終了日が JST 基準', () => {
	// 旧実装 (独自 formatDate のローカル getter) はこの窓で 07-26 / 08-02 を保存し、
	// 読み出し側 (todayDateJST 基準の active 判定) より 1 日短いトライアルになっていた。
	it('[T1] UTC 日曜 15:00 (JST 月曜 00:00) → 開始 07-27 / 終了 08-03 (7 日間)', async () => {
		freezeUtc('2026-07-26T15:00:00Z');
		await startTrial({ tenantId: 'tenant1', source: 'user_initiated', durationDays: 7 });
		expect(mockTrialInsert).toHaveBeenCalledWith(
			expect.objectContaining({ startDate: '2026-07-27', endDate: '2026-08-03' }),
		);
	});

	it('[T2] UTC 日曜 14:59 (JST 日曜 23:59) → 開始 07-26 / 終了 08-02', async () => {
		freezeUtc('2026-07-26T14:59:00Z');
		await startTrial({ tenantId: 'tenant1', source: 'user_initiated', durationDays: 7 });
		expect(mockTrialInsert).toHaveBeenCalledWith(
			expect.objectContaining({ startDate: '2026-07-26', endDate: '2026-08-02' }),
		);
	});

	it('[T3] 年をまたぐトライアル (UTC 12/31 15:00 = JST 1/1 00:00)', async () => {
		freezeUtc('2026-12-31T15:00:00Z');
		await startTrial({ tenantId: 'tenant1', source: 'user_initiated', durationDays: 7 });
		expect(mockTrialInsert).toHaveBeenCalledWith(
			expect.objectContaining({ startDate: '2027-01-01', endDate: '2027-01-08' }),
		);
	});
});

// ---------------------------------------------------------------------------
// preset-challenges.resolvePresetChallengeDates — チャレンジ期間 (顧客画面: setup / challenges)
// ---------------------------------------------------------------------------
describe('#4015 preset-challenges — チャレンジ期間が JST 基準', () => {
	const preset = (start: string, end: string) =>
		({ startMonthDay: start, endMonthDay: end }) as never;

	it('[P1] UTC 月末 15:00 (JST 翌月 1 日) の this-month-* は 8 月', () => {
		const now = new Date('2026-07-31T15:00:00Z');
		expect(resolvePresetChallengeDates(preset('this-month-start', 'this-month-end'), now)).toEqual({
			startDate: '2026-08-01',
			endDate: '2026-08-31',
		});
	});

	it('[P2] UTC 月末 14:59 (JST 月末 23:59) の this-month-* は 7 月', () => {
		const now = new Date('2026-07-31T14:59:00Z');
		expect(resolvePresetChallengeDates(preset('this-month-start', 'this-month-end'), now)).toEqual({
			startDate: '2026-07-01',
			endDate: '2026-07-31',
		});
	});

	it('[P3] today / today-plus-N も窓の内側で JST の暦日を使う', () => {
		const now = new Date('2026-07-26T15:00:00Z'); // JST 2026-07-27 00:00
		expect(resolvePresetChallengeDates(preset('today', 'today-plus-6'), now)).toEqual({
			startDate: '2026-07-27',
			endDate: '2026-08-02',
		});
	});
});

// ---------------------------------------------------------------------------
// pmf-survey-service.getCurrentRound — 配信 round キー (6/1・12/1 09:00 JST cron の直上)
// ---------------------------------------------------------------------------
describe('#4015 pmf-survey-service.getCurrentRound — round が JST 基準', () => {
	// 旧実装 (`now.getMonth() + 1`) は UTC 5/31 のため H1 を返し、H2 配信 round と食い違っていた。
	it('[Q1] UTC 6/30 15:00 (JST 7/1 00:00) → H2 に切り替わる', () => {
		expect(getCurrentRound(new Date('2026-06-30T15:00:00Z'))).toBe('2026-H2');
	});

	it('[Q2] UTC 6/30 14:59 (JST 6/30 23:59) → まだ H1', () => {
		expect(getCurrentRound(new Date('2026-06-30T14:59:00Z'))).toBe('2026-H1');
	});

	it('[Q3] UTC 12/31 15:00 (JST 1/1 00:00) → 翌年 H1', () => {
		expect(getCurrentRound(new Date('2026-12-31T15:00:00Z'))).toBe('2027-H1');
	});
});

// ---------------------------------------------------------------------------
// ops-analytics-service.getMonthKey — cohort-analysis (#3449) と同じ UTC 月境界に固定
// ---------------------------------------------------------------------------
describe('#4015 ops-analytics-service.getMonthKey — UTC 月境界に固定 (#3449 整合)', () => {
	// 本 module の鍵は createdAt (ISO UTC) 由来のため、JST ではなく UTC を月境界にする。
	// 旧実装はローカル getter で、Lambda (UTC) と dev (JST) で結果が分岐していた。
	it('[O1] UTC 7/31 23:59 は 2026-07', () => {
		expect(getMonthKey('2026-07-31T23:59:00.000Z')).toBe('2026-07');
	});

	it('[O2] UTC 8/1 00:00 は 2026-08', () => {
		expect(getMonthKey('2026-08-01T00:00:00.000Z')).toBe('2026-08');
	});

	it('[O3] UTC 7/31 15:00 (JST 8/1) も UTC 基準なので 2026-07 のまま', () => {
		expect(getMonthKey('2026-07-31T15:00:00.000Z')).toBe('2026-07');
	});

	it('[O4] Date 引数でも同じ結果', () => {
		expect(getMonthKey(new Date('2026-08-01T00:00:00.000Z'))).toBe('2026-08');
	});
});
