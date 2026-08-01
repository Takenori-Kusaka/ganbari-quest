// tests/unit/architecture/tz-invariance.test.ts (#4127)
//
// # 何を表明する test か
//
// 「日付の導出がプロセス TZ に依存しない」ことを、**記法ではなく振る舞いで**表明する
// fitness function (ADR-0061 原則 2)。
//
// #4015 で入れた静的 gate は検出対象を getter 4 語の列挙で定義していたため、同じ欠陥クラスの
// 別の書き方 (`getHours()` / `toISOString().slice(0,10)` / `toLocaleDateString()`) を素通しした。
// 列挙を足すだけでは 3 回目が来る。そこで本 test は、顧客に見える日付導出を
// **`TZ=UTC` (Lambda) と `TZ=Asia/Tokyo` (NUC) の 2 環境で実行し、どちらでも JST 暦の期待値と
// 一致すること**を assert する。これは書き方に依存しないため、新しい記法にも自動的に効く。
//
// 評価の瞬間は `TZ_PROBE_INSTANT_ISO` = JST 2026-08-01 00:30 (= UTC 2026-07-31 15:30)。
// JST 00:00〜09:00 の窓かつ月境界の内側なので、
//   - プロセス TZ 依存 (ローカル getter) → 2 TZ で結果が割れる
//   - UTC 導出 (toISOString().slice) → 2 TZ で一致するが JST 期待値 (2026-08-01 / 2026-08) と割れる
// の両方が 1 つの assertion で落ちる。
//
// registry (`scripts/lib/ci/tz-invariance-cases.mjs`) との対応は双方向に検査する
// (case を消して registry だけ残す / registry に無い case を足す、のどちらも fail)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	TZ_INVARIANCE_CASE_IDS,
	TZ_PROBE_INSTANT_ISO,
	TZ_PROBE_JST_DATE,
	TZ_PROBE_JST_MONTH,
	TZ_PROBE_TIMEZONES,
} from '../../../scripts/lib/ci/tz-invariance-cases.mjs';

// ---------- mocks (case が触れる I/O のみ) ----------

const mockLoadBonusOverrides = vi.fn();
vi.mock('$lib/marketplace/strategies/rule-preset/bonus-state', () => ({
	loadBonusOverrides: (...args: unknown[]) => mockLoadBonusOverrides(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFindTodayUsageLogs = vi.fn();
const mockFindUsageLogsByChildAndDateRange = vi.fn();
vi.mock('$lib/server/db/usage-log-repo', () => ({
	findTodayUsageLogs: (...args: unknown[]) => mockFindTodayUsageLogs(...args),
	findUsageLogsByChildAndDateRange: (...args: unknown[]) =>
		mockFindUsageLogsByChildAndDateRange(...args),
	closeOpenSessions: vi.fn(),
	insertUsageLog: vi.fn(),
	updateUsageLogEnd: vi.fn(),
}));

vi.mock('$lib/runtime/env', () => ({
	getEnv: () => ({ DATA_SOURCE: 'sqlite' }),
}));

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: (...args: unknown[]) => mockGetSetting(...args),
	setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

const mockFindRestDays = vi.fn();
const mockCountRestDaysInMonth = vi.fn();
vi.mock('$lib/server/db/evaluation-repo', () => ({
	findRestDays: (...args: unknown[]) => mockFindRestDays(...args),
	countRestDaysInMonth: (...args: unknown[]) => mockCountRestDaysInMonth(...args),
	insertRestDay: vi.fn(async () => ({ ok: true })),
	deleteRestDay: vi.fn(),
}));

import {
	addDaysJST,
	jstDayStartUtcIso,
	jstHour,
	monthKeyJST,
	prevDateJST,
	todayDateJST,
	weekStartJST,
} from '$lib/domain/date-utils';
import { asChildId } from '$lib/domain/ids';
import { evaluateBonusHooks } from '$lib/server/services/bonus-hook-service';
import { incrementSubscriptionMonth } from '$lib/server/services/loyalty-service';
import {
	getTodayUsageSummary,
	getWeeklyUsageSummary,
} from '$lib/server/services/usage-log-service';
import { GET as restDaysGet } from '../../../src/routes/api/v1/rest-days/[childId]/+server';

// ---------- harness ----------

const TENANT = 'tz-invariance-tenant';
const originalTz = process.env.TZ;

/** 実装済 case の id → 実行関数。registry と双方向に照合される。 */
const implementedCases: Record<string, () => Promise<void> | void> = {};

/**
 * case を登録する。`TZ_PROBE_TIMEZONES` の各 TZ で同じ body を実行する
 * (期待値は JST 暦の固定値なので、TZ 不変性と JST 正しさを同時に見ている)。
 */
function tzCase(id: string, body: () => Promise<void> | void): void {
	implementedCases[id] = body;
	describe(id, () => {
		for (const tz of TZ_PROBE_TIMEZONES) {
			it(`TZ=${tz} で JST 暦の期待値と一致する`, async () => {
				process.env.TZ = tz;
				vi.useFakeTimers();
				vi.setSystemTime(new Date(TZ_PROBE_INSTANT_ISO));
				try {
					await body();
				} finally {
					vi.useRealTimers();
				}
			});
		}
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	// CI は TZ 未設定で走るため、`= undefined` 代入だと文字列 'undefined' が残り
	// 同一 worker の後続 test を汚染する。未設定だった場合は delete で戻す。
	if (originalTz === undefined) {
		delete process.env.TZ;
	} else {
		process.env.TZ = originalTz;
	}
});

// ---------- cases ----------

tzCase('date-utils/today-date-jst', () => {
	expect(todayDateJST()).toBe(TZ_PROBE_JST_DATE);
	expect(monthKeyJST()).toBe(TZ_PROBE_JST_MONTH);
	// 2026-08-01 は土曜。その週の月曜は 2026-07-27
	expect(weekStartJST()).toBe('2026-07-27');
});

tzCase('date-utils/jst-hour', () => {
	// JST 00:30 の記録
	expect(jstHour()).toBe(0);
	// JST 07:00 (= UTC 22:00 前日) / JST 15:00 (= UTC 06:00)
	expect(jstHour(new Date('2026-07-31T22:00:00Z'))).toBe(7);
	expect(jstHour(new Date('2026-08-01T06:00:00Z'))).toBe(15);
});

tzCase('date-utils/add-days-jst', () => {
	expect(prevDateJST(TZ_PROBE_JST_DATE)).toBe('2026-07-31');
	expect(addDaysJST(TZ_PROBE_JST_DATE, -1)).toBe('2026-07-31');
	expect(addDaysJST(TZ_PROBE_JST_DATE, 1)).toBe('2026-08-02');
	expect(addDaysJST('2026-03-01', -1)).toBe('2026-02-28');
});

tzCase('bonus-hook/early-bird-hour', async () => {
	const earlyBird = {
		presetId: 'early-bird',
		presetName: 'early-bird',
		presetIcon: '🌅',
		enabled: true,
		rules: [
			{ title: 'はやおきボーナス', pointBonus: 5, description: '', icon: '🌅' },
			{ title: 'あさかつウィーク', pointBonus: 25, description: '', icon: '🌅' },
		],
		importedAt: '2026-05-01T00:00:00Z',
	};
	mockLoadBonusOverrides.mockResolvedValue({ presets: [earlyBird] });

	const ctxBase = {
		childId: asChildId('1'),
		categoryId: null,
		consecutiveDays: 1,
		isFirstToday: true,
		todayRecordCount: 1,
	} as unknown as Parameters<typeof evaluateBonusHooks>[0];

	// JST 07:00 の記録 → はやおきボーナスが付く
	const morning = await evaluateBonusHooks(
		{ ...ctxBase, recordedAt: new Date('2026-07-31T22:00:00Z') },
		TENANT,
	);
	expect(morning.hits.map((h) => h.ruleTitle)).toContain('はやおきボーナス');

	// JST 15:00 の記録 → 付かない
	const afternoon = await evaluateBonusHooks(
		{ ...ctxBase, recordedAt: new Date('2026-08-01T06:00:00Z') },
		TENANT,
	);
	expect(afternoon.hits.map((h) => h.ruleTitle)).not.toContain('はやおきボーナス');
});

tzCase('usage-log/today-summary-date-key', async () => {
	mockFindTodayUsageLogs.mockResolvedValue([]);
	await getTodayUsageSummary(TENANT, [{ id: asChildId('1'), nickname: 'たろう' }]);
	// 「今日」の下限は JST 00:00 に対応する UTC の瞬間 (UTC 暦日の前方一致だと 9 時間ずれる)
	expect(mockFindTodayUsageLogs).toHaveBeenCalledWith(TENANT, jstDayStartUtcIso(TZ_PROBE_JST_DATE));
});

tzCase('usage-log/weekly-summary-buckets', async () => {
	mockFindUsageLogsByChildAndDateRange.mockResolvedValue([
		// JST 2026-08-01 00:10 の利用 (UTC では 2026-07-31)
		{ childId: asChildId('1'), startedAt: '2026-07-31T15:10:00.000Z', durationSec: 600 },
	]);
	const weekly = await getWeeklyUsageSummary(TENANT, asChildId('1'));
	expect(weekly.map((e) => e.date)).toEqual([
		'2026-07-26',
		'2026-07-27',
		'2026-07-28',
		'2026-07-29',
		'2026-07-30',
		'2026-07-31',
		'2026-08-01',
	]);
	// JST 00:10 の利用は「今日 (2026-08-01)」に積まれる
	expect(weekly.find((e) => e.date === TZ_PROBE_JST_DATE)?.durationMin).toBe(10);
});

tzCase('loyalty/increment-month-key', async () => {
	mockGetSetting.mockResolvedValue(null);
	mockSetSetting.mockResolvedValue(undefined);
	await incrementSubscriptionMonth(TENANT);
	const monthKeyWrites = mockSetSetting.mock.calls.filter((c) =>
		String(c[1]).match(/^\d{4}-\d{2}$/),
	);
	expect(monthKeyWrites.length).toBeGreaterThan(0);
	for (const call of monthKeyWrites) expect(call[1]).toBe(TZ_PROBE_JST_MONTH);
});

tzCase('rest-days/month-symmetry', async () => {
	mockFindRestDays.mockResolvedValue([]);
	mockCountRestDaysInMonth.mockResolvedValue(0);
	const url = new URL('http://localhost/api/v1/rest-days/1');
	await restDaysGet({
		params: { childId: '1' },
		url,
		locals: { context: { tenantId: TENANT } },
		// biome-ignore lint/suspicious/noExplicitAny: RequestEvent の未使用フィールドは省略する
	} as any);
	// GET の既定月 (導出) が JST 月キーであること = POST 側 (`date.slice(0, 7)` = JST 日付由来) と同じ基準
	expect(mockFindRestDays).toHaveBeenCalledWith(expect.anything(), TZ_PROBE_JST_MONTH, TENANT);
});

// ---------- registry との双方向照合 (no-silent-gap) ----------

describe('registry closure', () => {
	it('registry の全 case が実装されている', () => {
		const missing = TZ_INVARIANCE_CASE_IDS.filter((id: string) => !(id in implementedCases));
		expect(missing, `registry にあるが未実装の case: ${missing.join(', ')}`).toEqual([]);
	});

	it('実装済 case が全て registry に登録されている', () => {
		const undeclared = Object.keys(implementedCases).filter(
			(id) => !TZ_INVARIANCE_CASE_IDS.includes(id),
		);
		expect(undeclared, `registry 未登録の case: ${undeclared.join(', ')}`).toEqual([]);
	});
});
