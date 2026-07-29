// tests/unit/services/child-challenge-service.test.ts
// per-child チャレンジ サービス層 unit test (#2362 PR-7、ADR-0055、User §6)
//
// 検証範囲:
//   - calcAgeAdjustedTarget (年齢調整ロジック)
//   - createChildChallenge / createChildChallengesBulk (per-child instance 作成)
//   - getChallengeGroupsForAdmin (sourceTemplateId / (title + 期間) group 化)
//   - updateChildChallengeProgress (count 増分 + completed 判定)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';

const mockInsert = vi.fn();
const mockGetOrCreateWeeklyAuto = vi.fn();
const mockInsertBulk = vi.fn();
const mockFindAllByTenant = vi.fn();
const mockFindByChildId = vi.fn();
const mockFindActiveByChildId = vi.fn();
const mockFindActiveOrUnclaimedByChildId = vi.fn();
const mockUpdateProgress = vi.fn();
const mockMarkCompleted = vi.fn();
const mockFindById = vi.fn();
const mockClaimRewardAndGrantPoints = vi.fn();
const mockFindAllChildren = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: {
			insert: (...a: unknown[]) => mockInsert(...a),
			getOrCreateWeeklyAuto: (...a: unknown[]) => mockGetOrCreateWeeklyAuto(...a),
			insertBulk: (...a: unknown[]) => mockInsertBulk(...a),
			findAllByTenant: (...a: unknown[]) => mockFindAllByTenant(...a),
			findByChildId: (...a: unknown[]) => mockFindByChildId(...a),
			findActiveByChildId: (...a: unknown[]) => mockFindActiveByChildId(...a),
			findActiveOrUnclaimedByChildId: (...a: unknown[]) => mockFindActiveOrUnclaimedByChildId(...a),
			updateProgress: (...a: unknown[]) => mockUpdateProgress(...a),
			markCompleted: (...a: unknown[]) => mockMarkCompleted(...a),
			findById: (...a: unknown[]) => mockFindById(...a),
			claimRewardAndGrantPoints: (...a: unknown[]) => mockClaimRewardAndGrantPoints(...a),
		},
	}),
}));

// #3213: 生成アルゴリズム (computeProposal / getWeekStart / getLastWeekStart / aggregateCategoryCounts)
// は child-challenge-service へ移設したため実物を使い、その内部依存である
// activity-log-aggregation.aggregateActivityLogsByCategory のみ mock する。
// aggregateCategoryCounts は内部で aggregateActivityLogsByCategory().summary.byCategory[id].count を
// 読むため、テストの「カテゴリ別記録数 map」を summary 形に変換して mock 戻り値に詰める。
const mockAggregateActivityLogsByCategory = vi.fn();
/** カテゴリ別記録数 map → aggregateActivityLogsByCategory().summary.byCategory 形に変換して mock させる */
function mockCategoryCounts(counts: Record<number, number>): void {
	const byCategory: Record<number, { count: number; points: number }> = {};
	for (const [id, count] of Object.entries(counts)) {
		byCategory[Number(id)] = { count, points: 0 };
	}
	mockAggregateActivityLogsByCategory.mockResolvedValue({
		logs: [],
		summary: { totalCount: 0, totalPoints: 0, byCategory },
	});
}
vi.mock('$lib/server/services/activity-log-aggregation', () => ({
	aggregateActivityLogsByCategory: (...a: unknown[]) => mockAggregateActivityLogsByCategory(...a),
}));

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...a: unknown[]) => mockFindAllChildren(...a),
}));

// #4003: `todayDateJST` だけを固定し、他は実装を通す部分 mock にする。
// 全 export を差し替える形だと、date-utils に関数が増えたとき
// 「No "xxx" export is defined on the mock」で**この test file 全体が落ちる**
// (weekStartJST 追加時に実際に 10 件落ちた)。テストが固定したいのは「今日」だけなので、
// 曜日計算 (weekStartJST) は実物を使う — mock で置き換えると検証対象が消える。
vi.mock('$lib/domain/date-utils', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/domain/date-utils')>()),
	todayDateJST: () => '2026-05-25',
}));

import {
	buildPerChildTargets,
	type ChallengePrev,
	calcAgeAdjustedTarget,
	claimChildChallengeReward,
	computeProposal,
	createChildChallenge,
	createChildChallengesBulk,
	getActiveChildChallengesWithSiblings,
	getChallengeGroupsForAdmin,
	getLastWeekStart,
	getOrCreateWeeklyChildChallenge,
	getWeekStart,
	updateChildChallengeProgress,
} from '../../../src/lib/server/services/child-challenge-service';

const TENANT = 'test-tenant-001';

beforeEach(() => {
	vi.clearAllMocks();
});

// ============================================================
// #4051: 固定時計 + 固定期待値 (期待値を被検証対象から作らない)
//
// 旧実装は fixture の `startDate` / prior 週を **`getWeekStart()` 呼び出しで組み立てて**
// いた。SUT (`getOrCreateWeeklyChildChallenge`) も同じ `getWeekStart()` を呼ぶため、
// 両者はどの週に実行しても必ず一致し、**`getWeekStart()` 自体が壊れても test は緑のまま**
// だった (実際 #4003 の週頭ずれを本 test は一度も検出していない)。
//
// 対処: 時計を固定し、期待値は SUT を通さない固定文字列 (下の MONDAYS) で置く。
//
// TZ の扱い: `getWeekStart()` の戻り値はプロセス TZ に依存しうるため、各 case は
// 実運用で使われる 2 つの TZ (CI runner / 本番 Lambda = UTC、Dev ローカル = Asia/Tokyo)
// を明示 pin して両方で同じ固定値になることまで assert する。固定時刻は「JST 月曜 00:00
// (= UTC 日曜 15:00) の前後」を跨ぐ 2 点を選ぶ。
// ============================================================

/** 2026 年の月曜日 (index = 基準週から何週前か)。SUT を経由しない固定値。 */
const MONDAYS = [
	'2026-07-27',
	'2026-07-20',
	'2026-07-13',
	'2026-07-06',
	'2026-06-29',
	'2026-06-22',
	'2026-06-15',
] as const;

/** 期待値を pin する固定時計。週境界 (JST 月曜 00:00 = UTC 日曜 15:00) の前後 2 点。 */
const FIXED_CLOCKS = [
	{
		label: 'JST 日曜 23:00 (週境界の手前)',
		iso: '2026-07-26T14:00:00Z',
		weekStart: '2026-07-20',
	},
	{
		label: 'JST 月曜 09:00 (週境界の直後)',
		iso: '2026-07-27T00:00:00Z',
		weekStart: '2026-07-27',
	},
] as const;

/** 実運用で使われるプロセス TZ。どちらでも同じ固定値になることを assert する。 */
const PINNED_TIMEZONES = ['UTC', 'Asia/Tokyo'] as const;

/**
 * 週境界の 9 時間窓 (JST 月曜 00:00〜09:00 = UTC 日曜 15:00〜24:00) の内側にある時刻。
 * この窓では JST の暦日と UTC の暦日が別日になるため、**週頭を JST 以外の基準で出す実装は
 * 必ず前週を返す**。#4003 の実害 (週次チャレンジのバッジが毎週 9 時間消える) の発生条件そのもの。
 */
const JST_WEEK_BOUNDARY_WINDOW = {
	iso: '2026-07-26T15:30:00Z', // JST 月曜 00:30 / UTC 日曜 15:30
	weekStart: '2026-07-27',
} as const;

const ORIGINAL_TZ = process.env.TZ;

/** プロセス TZ を pin し、Date のみ fake にして時刻を固定する (timer 系は素のまま)。 */
function freezeClock(iso: string, tz: string): void {
	process.env.TZ = tz;
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(iso));
}

function restoreClock(): void {
	vi.useRealTimers();
	if (ORIGINAL_TZ === undefined) {
		delete process.env.TZ;
	} else {
		process.env.TZ = ORIGINAL_TZ;
	}
}

/** 固定 weekStart から n 週前の月曜を **表引き**で返す (日付計算も SUT も経由しない)。 */
function fixedWeeksAgo(weekStart: string, n: number): string {
	const base = MONDAYS.indexOf(weekStart as (typeof MONDAYS)[number]);
	const value = MONDAYS[base + n];
	if (base < 0 || value === undefined) {
		throw new Error(`MONDAYS 表に ${weekStart} の ${n} 週前がない`);
	}
	return value;
}

// ============================================================
// 週次チャレンジ生成アルゴリズム (#3194 / #3213、旧 auto-challenge-service.test.ts より移設)
// auto_challenges 廃止 (#3213) に伴い computeProposal / getWeekStart / getLastWeekStart は
// child-challenge-service へ移設したため、#3194 で強化したアルゴリズム挙動
// (苦手中心＋時々得意＋翌週適応＋consecutiveMissCount) の回帰テストも本ファイルへ移設する。
// ============================================================

// computeProposal は (counts, prev, weekStart) を取る純粋関数。
// weekIndexOf(weekStart) % 4 === 0 を「得意週」とするため、テストの weekStart は週インデックスで選ぶ。
// 2026-01-05(月) の週インデックスは 2922 (= 2922 % 4 = 2 → 非得意週)。得意週検証用に別 weekStart を使う。
const WEEK_WEAKNESS = '2026-01-05'; // 非得意週 (weekIndex % 4 !== 0)
function algoCounts(byId: Record<number, number>): Record<number, number> {
	return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...byId };
}
function makePrev(over: Partial<ChallengePrev> = {}): ChallengePrev {
	return {
		categoryId: asCategoryId(2),
		targetCount: 3,
		currentCount: 0,
		status: 'expired',
		consecutiveMissCount: 0,
		...over,
	};
}

describe('getWeekStart (#3213 移設)', () => {
	it('returns Monday for a Monday date', () => {
		// 2026-04-06 is a Monday
		expect(getWeekStart(new Date(2026, 3, 6))).toBe('2026-04-06');
	});

	it('returns previous Monday for a Wednesday', () => {
		// 2026-04-08 is a Wednesday
		expect(getWeekStart(new Date(2026, 3, 8))).toBe('2026-04-06');
	});

	it('returns previous Monday for a Sunday', () => {
		// 2026-04-12 is a Sunday
		expect(getWeekStart(new Date(2026, 3, 12))).toBe('2026-04-06');
	});

	it('returns previous Monday for a Saturday', () => {
		// 2026-04-11 is a Saturday
		expect(getWeekStart(new Date(2026, 3, 11))).toBe('2026-04-06');
	});
});

describe('getLastWeekStart (#3213 移設)', () => {
	it('returns the Monday 7 days before the given weekStart', () => {
		expect(getLastWeekStart('2026-01-05')).toBe('2025-12-29');
	});
});

describe('computeProposal — カテゴリ選択 (§3.4、#3194 / #3213 移設)', () => {
	const STRENGTH_WEEK = '2026-01-19'; // weekIndex % 4 === 0 → 得意週

	it('データ不足なら explore モード (target=最小2)', () => {
		const p = computeProposal(algoCounts({ 1: 2 }), undefined, WEEK_WEAKNESS);
		expect(p.mode).toBe('explore');
		expect(p.targetCount).toBe(2);
		expect(p.reason).toContain('まだ記録が少ない');
	});

	it('通常週は weakness モード (target は 2〜7 に収まる)', () => {
		const p = computeProposal(
			algoCounts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 }),
			undefined,
			WEEK_WEAKNESS,
		);
		expect(p.mode).toBe('weakness');
		expect(p.targetCount).toBeGreaterThanOrEqual(2);
		expect(p.targetCount).toBeLessThanOrEqual(7);
		expect(p.consecutiveMissCount).toBe(0);
	});

	it('得意週は strength モードで最多カテゴリを選ぶ', () => {
		const p = computeProposal(algoCounts({ 1: 8, 5: 0 }), undefined, STRENGTH_WEEK);
		expect(p.mode).toBe('strength');
		expect(p.categoryId).toBe('1'); // 最多 = うんどう
		expect(p.targetCount).toBe(5); // avg 4 → base clamp(5,2,7)
	});
});

describe('computeProposal — 翌週適応 (Flow 3 分岐、#3194 / #3213 移設)', () => {
	const STRENGTH_WEEK = '2026-01-19';

	it('前週完了 + 大幅超過なら target を上げる (+2)', () => {
		// 得意週 → 最多カテゴリ1 を決定的に選択。prev も cat1 完了で overshoot 2
		const prev = makePrev({
			categoryId: asCategoryId(1),
			status: 'completed',
			targetCount: 5,
			currentCount: 7,
		});
		const p = computeProposal(algoCounts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.categoryId).toBe('1');
		expect(p.targetCount).toBe(7); // max(base3, 5+2)=7
	});

	it('前週未達 (半分以上) なら据え置き', () => {
		const prev = makePrev({
			categoryId: asCategoryId(1),
			status: 'expired',
			targetCount: 5,
			currentCount: 3,
		});
		const p = computeProposal(algoCounts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.targetCount).toBe(5); // ratio 0.6 → 据置
		expect(p.consecutiveMissCount).toBe(1);
	});

	it('前週未達 (半分未満) なら 1 下げる', () => {
		const prev = makePrev({
			categoryId: asCategoryId(1),
			status: 'expired',
			targetCount: 5,
			currentCount: 1,
		});
		const p = computeProposal(algoCounts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.targetCount).toBe(4); // ratio 0.2 → -1
	});

	it('2 週連続未達なら rescue-strength (target 最小 + 得意カテゴリ)', () => {
		// prev が未達 + 既に 1 連続未達 → 今週 incoming streak = 2 → レスキュー
		const prev = makePrev({
			categoryId: asCategoryId(2),
			status: 'expired',
			consecutiveMissCount: 1,
			targetCount: 3,
			currentCount: 0,
		});
		const p = computeProposal(algoCounts({ 1: 6 }), prev, WEEK_WEAKNESS);
		expect(p.mode).toBe('rescue-strength');
		expect(p.categoryId).toBe('1'); // 最多 = 得意
		expect(p.targetCount).toBe(2); // MIN_TARGET
		expect(p.consecutiveMissCount).toBe(2);
	});

	it('前週完了なら連続未達カウントは 0 にリセット', () => {
		const prev = makePrev({ status: 'completed', consecutiveMissCount: 3 });
		const p = computeProposal(algoCounts({ 1: 8, 2: 4 }), prev, WEEK_WEAKNESS);
		expect(p.consecutiveMissCount).toBe(0);
	});
});

describe('computeProposal — #3203 item1: skip 週 (disengagement) を rescue に反映', () => {
	const WEAK_COUNTS = algoCounts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 });

	it('前週完了でも 2 週 skip すれば streak=2 で rescue-strength 発火', () => {
		// 完了後に 2 週 challenge 未生成 (skip) = disengagement → 跨いで rescue 対象にする
		const prev = makePrev({ status: 'completed', consecutiveMissCount: 0 });
		const p = computeProposal(WEAK_COUNTS, prev, WEEK_WEAKNESS, { skippedWeeks: 2 });
		expect(p.consecutiveMissCount).toBe(2);
		expect(p.mode).toBe('rescue-strength');
	});

	it('前週未達 + 1 週 skip で streak=2 (1 missed + 1 skipped) → rescue', () => {
		const prev = makePrev({ status: 'expired', consecutiveMissCount: 0 });
		const p = computeProposal(WEAK_COUNTS, prev, WEEK_WEAKNESS, { skippedWeeks: 1 });
		expect(p.consecutiveMissCount).toBe(2);
		expect(p.mode).toBe('rescue-strength');
	});

	it('skippedWeeks=0 (連続週) は従来挙動 (完了→streak 0、rescue なし)', () => {
		const prev = makePrev({ status: 'completed', consecutiveMissCount: 0 });
		const p = computeProposal(WEAK_COUNTS, prev, WEEK_WEAKNESS, { skippedWeeks: 0 });
		expect(p.consecutiveMissCount).toBe(0);
		expect(p.mode).not.toBe('rescue-strength');
	});
});

describe('computeProposal — #3203 item2: childId+weekStart で seed 化し決定的', () => {
	const WEAK_COUNTS = algoCounts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 });

	it('同 childId・同週は常に同一カテゴリを返す (flip-flop なし)', () => {
		const a = computeProposal(WEAK_COUNTS, undefined, WEEK_WEAKNESS, { childId: asChildId(42) });
		const b = computeProposal(WEAK_COUNTS, undefined, WEEK_WEAKNESS, { childId: asChildId(42) });
		const c = computeProposal(WEAK_COUNTS, undefined, WEEK_WEAKNESS, { childId: asChildId(42) });
		expect(a.categoryId).toBe(b.categoryId);
		expect(b.categoryId).toBe(c.categoryId);
		expect(a.mode).toBe('weakness');
	});

	it('childId 未指定でも従来通り動作する (Math.random フォールバック、後方互換)', () => {
		const p = computeProposal(WEAK_COUNTS, undefined, WEEK_WEAKNESS);
		expect(p.mode).toBe('weakness');
		expect(['1', '2', '3', '4', '5']).toContain(p.categoryId);
	});
});

describe('getOrCreateWeeklyChildChallenge (#3195 アプリ自動生成)', () => {
	it('当週分が無ければ child_challenges を自動生成する (targetConfig に metric/categoryId/genMode 内包)', async () => {
		mockFindByChildId.mockResolvedValue([]); // 既存なし
		mockCategoryCounts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 });
		// #3245: 生成は atomic な getOrCreateWeeklyAuto 経由
		mockGetOrCreateWeeklyAuto.mockImplementation(async (input) => ({
			id: '1',
			currentValue: 0,
			completed: 0,
			...input,
		}));

		await getOrCreateWeeklyChildChallenge(asChildId(10), TENANT);

		expect(mockGetOrCreateWeeklyAuto).toHaveBeenCalledTimes(1);
		const input = mockGetOrCreateWeeklyAuto.mock.calls[0]?.[0];
		expect(input.sourceTemplateId).toBe('auto:weekly');
		expect(input.challengeType).toBe('cooperative');
		expect(input.periodType).toBe('weekly');
		const cfg = JSON.parse(input.targetConfig);
		expect(cfg.metric).toBe('count'); // 既存 updateChildChallengeProgress が増分できる形
		expect(Number(cfg.categoryId)).toBeGreaterThanOrEqual(1);
		expect(typeof cfg.genMode).toBe('string');
		expect(input.targetValue).toBeGreaterThanOrEqual(2); // MIN_TARGET
	});

	// #4051 AC1: fixture の startDate を getWeekStart() ではなく固定日付で置く。
	// getWeekStart() が壊れれば「当週分」と一致しなくなり、再生成が走って本 test が落ちる。
	describe.each(FIXED_CLOCKS)('当週分が既にあれば再生成しない (冪等) — $label', (clock) => {
		afterEach(() => {
			restoreClock();
		});

		it.each(PINNED_TIMEZONES)('TZ=%s', async (tz) => {
			freezeClock(clock.iso, tz);
			// 週頭の固定値そのものを先に pin する (SUT の内部一致だけでなく戻り値も検証)
			expect(getWeekStart()).toBe(clock.weekStart);

			const existing = {
				id: '99',
				childId: asChildId(10),
				sourceTemplateId: 'auto:weekly',
				startDate: clock.weekStart,
				targetConfig: '{"metric":"count","categoryId":2,"baseTarget":3}',
			};
			mockFindByChildId.mockResolvedValue([existing]);

			const result = await getOrCreateWeeklyChildChallenge(asChildId(10), TENANT);
			expect(result).toBe(existing);
			expect(mockGetOrCreateWeeklyAuto).not.toHaveBeenCalled();
			expect(mockInsert).not.toHaveBeenCalled();
			expect(mockAggregateActivityLogsByCategory).not.toHaveBeenCalled();
		});
	});

	// #4051 AC2: 週境界の 9 時間窓 (JST 月曜 00:00〜09:00) を固定値で pin する。
	// この窓では JST 暦日 ≠ UTC 暦日 なので、**週頭をローカル日付要素で算出する実装
	// (= #4003 で直す前の getWeekStart)** は TZ=UTC の runner で前週を返し、必ず落ちる。
	// 本番 Lambda / CI runner は TZ 未設定 (= UTC) なので、UTC 側こそが実害の起きる条件。
	describe('週境界の 9 時間窓 (JST 月曜 00:00〜09:00) でも当週は JST 基準で決まる', () => {
		afterEach(() => {
			restoreClock();
		});

		it.each(PINNED_TIMEZONES)('TZ=%s で週頭が翌週の月曜になる (前週を返さない)', (tz) => {
			freezeClock(JST_WEEK_BOUNDARY_WINDOW.iso, tz);
			expect(getWeekStart()).toBe(JST_WEEK_BOUNDARY_WINDOW.weekStart);
		});

		it.each(PINNED_TIMEZONES)('TZ=%s で当週分の行があれば再生成しない (冪等)', async (tz) => {
			freezeClock(JST_WEEK_BOUNDARY_WINDOW.iso, tz);
			const existing = {
				id: '97',
				childId: asChildId(10),
				sourceTemplateId: 'auto:weekly',
				startDate: JST_WEEK_BOUNDARY_WINDOW.weekStart,
				targetConfig: '{"metric":"count","categoryId":2,"baseTarget":3}',
			};
			mockFindByChildId.mockResolvedValue([existing]);

			expect(await getOrCreateWeeklyChildChallenge(asChildId(10), TENANT)).toBe(existing);
			expect(mockGetOrCreateWeeklyAuto).not.toHaveBeenCalled();
		});
	});

	// #4051 AC1: 固定日付でない (= 当週でない) 行しかなければ生成が走ることも pin する。
	// 上の冪等 test だけだと「常に再生成しない」実装でも緑になるため、対の負例を置く。
	describe.each(FIXED_CLOCKS)('前週分しかなければ当週分を生成する — $label', (clock) => {
		afterEach(() => {
			restoreClock();
		});

		it.each(PINNED_TIMEZONES)('TZ=%s', async (tz) => {
			freezeClock(clock.iso, tz);
			mockCategoryCounts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 });
			mockGetOrCreateWeeklyAuto.mockImplementation(async (input) => ({
				id: '1',
				currentValue: 0,
				completed: 0,
				...input,
			}));
			mockFindByChildId.mockResolvedValue([
				{
					id: '98',
					childId: asChildId(10),
					sourceTemplateId: 'auto:weekly',
					startDate: fixedWeeksAgo(clock.weekStart, 1),
					targetConfig: '{"metric":"count","categoryId":2,"baseTarget":3}',
					targetValue: 3,
					currentValue: 3,
					completed: 1,
					status: 'completed',
				},
			]);

			await getOrCreateWeeklyChildChallenge(asChildId(10), TENANT);

			expect(mockGetOrCreateWeeklyAuto).toHaveBeenCalledTimes(1);
			expect(mockGetOrCreateWeeklyAuto.mock.calls[0]?.[0].startDate).toBe(clock.weekStart);
		});
	});

	// #3472 (integration): getOrCreateWeeklyChildChallenge 経由で priorAuto 採用 + weeksBetween-1 の
	// skip 算出を検証する。unit (#3203) は computeProposal へ直接 skippedWeeks を手渡すが、本 test は
	// repo 行 (複数 prior・連続/非連続週・同一週重複) からの skip 導出 path 全体を網羅する (ADR-0005/0006)。
	describe('#3472: skip 算出 integration (priorAuto + weeksBetween-1)', () => {
		/** 過去 prior auto:weekly 行を組み立てる。completed=1 で前週完了相当。 */
		function priorAutoRow(startDate: string, over: Record<string, unknown> = {}) {
			return {
				id: '1',
				childId: asChildId(10),
				sourceTemplateId: 'auto:weekly',
				startDate,
				targetConfig: JSON.stringify({ categoryId: asCategoryId(2), genMissStreak: 0 }),
				targetValue: 3,
				currentValue: 3,
				completed: 1, // 完了 → prev streak 0
				status: 'completed',
				...over,
			};
		}
		// #4051 AC1: 起点を `getWeekStart()` から作らない。時計を固定し、n 週前は MONDAYS の
		// 表引きで得る (被検証対象と同じ関数で期待値を作ると、その関数の欠陥を検出できない)。
		const CLOCK = FIXED_CLOCKS[1]; // JST 月曜 09:00 → 当週 = 2026-07-27

		/** 当週 (固定) から n 週前の月曜。SUT も日付計算も経由しない表引き。 */
		function weeksAgo(n: number): string {
			return fixedWeeksAgo(CLOCK.weekStart, n);
		}

		afterEach(() => {
			restoreClock();
		});

		beforeEach(() => {
			freezeClock(CLOCK.iso, 'UTC');
			mockCategoryCounts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 }); // 非 explore
			mockGetOrCreateWeeklyAuto.mockImplementation(async (input) => ({
				id: '1',
				currentValue: 0,
				completed: 0,
				...input,
			}));
		});

		it('完了後 3 週前の prior のみ (= 2 週 skip) → rescue-strength を生成', async () => {
			const w3 = weeksAgo(3); // 3 週前 → weeksBetween=3 → skip=2
			mockFindByChildId.mockResolvedValue([priorAutoRow(w3)]);

			await getOrCreateWeeklyChildChallenge(asChildId(10), TENANT);
			const cfg = JSON.parse(mockGetOrCreateWeeklyAuto.mock.calls[0]?.[0].targetConfig);
			expect(cfg.genMode).toBe('rescue-strength');
			expect(cfg.genMissStreak).toBe(2); // skip 2 を miss streak に反映
		});

		it('連続週 (1 週前完了、skip 0) → rescue にならない', async () => {
			const w1 = weeksAgo(1); // 1 週前 → weeksBetween=1 → skip=0
			mockFindByChildId.mockResolvedValue([priorAutoRow(w1)]);

			await getOrCreateWeeklyChildChallenge(asChildId(10), TENANT);
			const cfg = JSON.parse(mockGetOrCreateWeeklyAuto.mock.calls[0]?.[0].targetConfig);
			expect(cfg.genMode).not.toBe('rescue-strength');
			expect(cfg.genMissStreak).toBe(0);
		});

		it('複数 prior 行から最新週を prev に採用する (sort 検証)', async () => {
			const w1 = weeksAgo(1);
			const w4 = weeksAgo(4);
			// 順不同で渡しても最新 (w1) が prev → skip 0
			mockFindByChildId.mockResolvedValue([priorAutoRow(w4), priorAutoRow(w1)]);

			await getOrCreateWeeklyChildChallenge(asChildId(10), TENANT);
			const cfg = JSON.parse(mockGetOrCreateWeeklyAuto.mock.calls[0]?.[0].targetConfig);
			expect(cfg.genMissStreak).toBe(0); // w1 採用 = skip 0
		});

		it('同一 startDate の prior 重複時も決定的に動く (skip 一意)', async () => {
			const w2 = weeksAgo(2); // skip=1
			mockFindByChildId.mockResolvedValue([priorAutoRow(w2), priorAutoRow(w2)]);

			await getOrCreateWeeklyChildChallenge(asChildId(10), TENANT);
			const cfg = JSON.parse(mockGetOrCreateWeeklyAuto.mock.calls[0]?.[0].targetConfig);
			// 2 週前完了 → skip 1 → streak 1 (rescue 閾値 2 未満)
			expect(cfg.genMissStreak).toBe(1);
		});
	});
});

describe('calcAgeAdjustedTarget', () => {
	it('ageAdjustments 未指定 → baseTarget をそのまま返す', () => {
		expect(calcAgeAdjustedTarget(10, undefined, 5)).toBe(10);
	});

	it('完全一致の age key があればそれを使う', () => {
		expect(calcAgeAdjustedTarget(10, { '5': 15, '10': 25 }, 5)).toBe(15);
	});

	it('完全一致なし → 「childAge 以下で最大の age key」を使う', () => {
		expect(calcAgeAdjustedTarget(10, { '3': 5, '6': 15, '10': 25 }, 8)).toBe(15);
	});

	it('childAge が最小 age key より小さい → baseTarget', () => {
		expect(calcAgeAdjustedTarget(10, { '6': 15 }, 4)).toBe(10);
	});
});

describe('createChildChallenge / createChildChallengesBulk', () => {
	it('createChildChallenge は repo.insert を呼び出す', async () => {
		mockInsert.mockResolvedValueOnce({ id: '1', childId: asChildId(902), title: 'foo' });
		const result = await createChildChallenge(
			{
				childId: asChildId(902),
				title: 'foo',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				targetConfig: '{}',
				rewardConfig: '{}',
				targetValue: 5,
			},
			TENANT,
		);
		expect(result.id).toBe('1');
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({ childId: asChildId(902), targetValue: 5 }),
			TENANT,
		);
	});

	it('createChildChallengesBulk は childIds 配列ぶん insertBulk inputs 生成', async () => {
		mockInsertBulk.mockResolvedValueOnce([
			{ id: '1', childId: asChildId(902), targetValue: 15 },
			{ id: '2', childId: asChildId(903), targetValue: 25 },
		]);
		const result = await createChildChallengesBulk(
			{
				title: 'みんなで',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				targetConfig: '{}',
				rewardConfig: '{}',
				sourceTemplateId: 'src:1',
				perChildTargets: { 902: 15, 903: 25 },
			},
			[asChildId(902), asChildId(903)],
			TENANT,
		);
		expect(result.length).toBe(2);
		expect(mockInsertBulk).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					childId: asChildId(902),
					targetValue: 15,
					sourceTemplateId: 'src:1',
				}),
				expect.objectContaining({
					childId: asChildId(903),
					targetValue: 25,
					sourceTemplateId: 'src:1',
				}),
			]),
			TENANT,
		);
	});

	it('perChildTargets で未指定 childId は targetValue=1 fallback', async () => {
		mockInsertBulk.mockResolvedValueOnce([{ id: '1' }]);
		await createChildChallengesBulk(
			{
				title: 'X',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				targetConfig: '{}',
				rewardConfig: '{}',
				perChildTargets: {},
			},
			[asChildId(902)],
			TENANT,
		);
		expect(mockInsertBulk).toHaveBeenCalledWith(
			[expect.objectContaining({ childId: asChildId(902), targetValue: 1 })],
			TENANT,
		);
	});
});

describe('getChallengeGroupsForAdmin', () => {
	it('同じ sourceTemplateId を持つ instance を group 化、各 instance が collect される', async () => {
		mockFindAllByTenant.mockResolvedValueOnce([
			{
				id: '1',
				childId: asChildId(902),
				title: 'A',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				periodType: 'weekly',
				sourceTemplateId: 'tmpl-1',
				completed: 0,
				targetValue: 5,
				currentValue: 2,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'active',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
			{
				id: '2',
				childId: asChildId(903),
				title: 'A',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				periodType: 'weekly',
				sourceTemplateId: 'tmpl-1',
				completed: 0,
				targetValue: 5,
				currentValue: 3,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'active',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
			{
				id: '3',
				childId: asChildId(902),
				title: 'B (individual)',
				startDate: '2026-05-20',
				endDate: '2026-05-27',
				periodType: 'weekly',
				sourceTemplateId: null,
				completed: 1,
				targetValue: 5,
				currentValue: 5,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'completed',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: '2026-05-27T09:00:00Z',
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
		]);

		const groups = await getChallengeGroupsForAdmin(TENANT);
		expect(groups.length).toBe(2);
		// 開始日降順 (新しい順): A (2026-05-25) > B (2026-05-20)
		// #3513 QM BLOCK fix: groupKey は sourceTemplateId + 期間 (startDate::endDate) の複合になる
		expect(groups[0]?.groupKey).toBe('tmpl-1::2026-05-25::2026-06-01');
		expect(groups[0]?.instances.length).toBe(2);
		expect(groups[0]?.allCompleted).toBe(false);
		expect(groups[1]?.groupKey).toContain('B (individual)');
		expect(groups[1]?.instances.length).toBe(1);
		expect(groups[1]?.allCompleted).toBe(true);
	});

	it('#3513 QM BLOCK fix: 同一 sourceTemplateId (auto:weekly) でも期間が異なれば別 group になる (全週混線防止)', async () => {
		mockFindAllByTenant.mockResolvedValueOnce([
			{
				id: '1',
				childId: asChildId(902),
				title: '今週のチャレンジ',
				startDate: '2026-05-25',
				endDate: '2026-05-31',
				periodType: 'weekly',
				sourceTemplateId: 'auto:weekly',
				completed: 1,
				targetValue: 5,
				currentValue: 5,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'completed',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: '2026-05-31T09:00:00Z',
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
			// 別の子供・前週分。sourceTemplateId は同じ固定文字列 'auto:weekly' だが期間が異なる。
			{
				id: '2',
				childId: asChildId(903),
				title: '先週のチャレンジ',
				startDate: '2026-05-18',
				endDate: '2026-05-24',
				periodType: 'weekly',
				sourceTemplateId: 'auto:weekly',
				completed: 0,
				targetValue: 5,
				currentValue: 1,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'active',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
		]);

		const groups = await getChallengeGroupsForAdmin(TENANT);

		// 混線していれば 1 group (allCompleted=false かつ instances.length=2) になるが、
		// 期間フィルタが効いていれば週ごとに別 group (それぞれ 1 instance) になる。
		expect(groups.length).toBe(2);
		expect(groups.every((g) => g.instances.length === 1)).toBe(true);
		const completedGroup = groups.find((g) => g.startDate === '2026-05-25');
		const activeGroup = groups.find((g) => g.startDate === '2026-05-18');
		expect(completedGroup?.allCompleted).toBe(true);
		expect(activeGroup?.allCompleted).toBe(false);
	});

	it('全 instance 完了で allCompleted=true', async () => {
		mockFindAllByTenant.mockResolvedValueOnce([
			{
				id: '1',
				childId: asChildId(902),
				title: 'X',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				periodType: 'weekly',
				sourceTemplateId: 'tmpl-x',
				completed: 1,
				targetValue: 5,
				currentValue: 5,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'completed',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: '',
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
			{
				id: '2',
				childId: asChildId(903),
				title: 'X',
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				periodType: 'weekly',
				sourceTemplateId: 'tmpl-x',
				completed: 1,
				targetValue: 5,
				currentValue: 5,
				description: null,
				rewardConfig: '{}',
				targetConfig: '{}',
				status: 'completed',
				isActive: 1,
				challengeType: 'cooperative',
				completedAt: '',
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '',
				updatedAt: '',
			},
		]);
		const groups = await getChallengeGroupsForAdmin(TENANT);
		expect(groups[0]?.allCompleted).toBe(true);
	});
});

describe('updateChildChallengeProgress', () => {
	it('count metric → currentValue 増分 + target 達成で markCompleted', async () => {
		mockFindActiveByChildId.mockResolvedValueOnce([
			{
				id: '10',
				childId: asChildId(902),
				title: 'P',
				completed: 0,
				currentValue: 4,
				targetValue: 5,
				targetConfig: JSON.stringify({ metric: 'count', baseTarget: 5 }),
				description: null,
				rewardConfig: '{}',
				challengeType: 'cooperative',
				periodType: 'weekly',
				startDate: '',
				endDate: '',
				status: 'active',
				isActive: 1,
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				sourceTemplateId: null,
				createdAt: '',
				updatedAt: '',
			},
		]);
		const results = await updateChildChallengeProgress(
			asChildId(902),
			asActivityId(999),
			asCategoryId(1),
			TENANT,
		);
		expect(mockUpdateProgress).toHaveBeenCalledWith('10', 5, TENANT);
		expect(mockMarkCompleted).toHaveBeenCalledWith('10', TENANT);
		expect(results[0]?.completed).toBe(true);
	});

	it('categoryId 不一致 → 進捗更新スキップ', async () => {
		mockFindActiveByChildId.mockResolvedValueOnce([
			{
				id: '11',
				childId: asChildId(902),
				title: 'P',
				completed: 0,
				currentValue: 0,
				targetValue: 5,
				targetConfig: JSON.stringify({
					metric: 'count',
					categoryId: asCategoryId(2),
					baseTarget: 5,
				}),
				description: null,
				rewardConfig: '{}',
				challengeType: 'cooperative',
				periodType: 'weekly',
				startDate: '',
				endDate: '',
				status: 'active',
				isActive: 1,
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				sourceTemplateId: null,
				createdAt: '',
				updatedAt: '',
			},
		]);
		// categoryId=1 で呼ぶ → targetConfig.categoryId=2 と不一致 → スキップ
		const results = await updateChildChallengeProgress(
			asChildId(902),
			asActivityId(999),
			asCategoryId(1),
			TENANT,
		);
		expect(mockUpdateProgress).not.toHaveBeenCalled();
		expect(results.length).toBe(0);
	});
});

describe('buildPerChildTargets', () => {
	it('child の age に応じて ageAdjustments を適用', async () => {
		mockFindAllChildren.mockResolvedValueOnce([
			{ id: '902', age: 5 },
			{ id: '903', age: 8 },
		]);
		const result = await buildPerChildTargets(
			10,
			{ '5': 15, '8': 25 },
			[asChildId(902), asChildId(903)],
			TENANT,
		);
		expect(result).toEqual({ 902: 15, 903: 25 });
	});

	it('child が見つからない → age=6 fallback', async () => {
		mockFindAllChildren.mockResolvedValueOnce([]);
		const result = await buildPerChildTargets(10, undefined, [asChildId(999)], TENANT);
		// baseTarget=10、ageAdjustments 未指定 → baseTarget そのまま
		expect(result).toEqual({ 999: 10 });
	});

	// #2488 (must-3 fix): pre-fetched children を受け取った場合 findAllChildren 呼出をスキップ
	it('prefetchedChildren 渡し時は findAllChildren を呼ばない (N+1 解消)', async () => {
		const result = await buildPerChildTargets(10, { '5': 15 }, [asChildId(902)], TENANT, [
			{ id: asChildId(902), age: 5 },
		]);
		expect(mockFindAllChildren).not.toHaveBeenCalled();
		expect(result).toEqual({ 902: 15 });
	});
});

// #2488 (must-1 + must-2 fix): regression tests
describe('getActiveChildChallengesWithSiblings — #2488 regression', () => {
	function row(overrides: Record<string, unknown>) {
		return {
			id: '0',
			childId: asChildId(902),
			title: 'X',
			startDate: '2026-05-25',
			endDate: '2026-06-01',
			periodType: 'weekly' as const,
			sourceTemplateId: 'tmpl-1',
			completed: 0,
			targetValue: 5,
			currentValue: 0,
			description: null,
			rewardConfig: '{}',
			targetConfig: '{}',
			status: 'active' as const,
			isActive: 1,
			challengeType: 'cooperative' as const,
			completedAt: null,
			rewardClaimed: 0,
			rewardClaimedAt: null,
			createdAt: '',
			updatedAt: '',
			...overrides,
		};
	}

	it('must-1: completed AND rewardClaimed=0 の自身 instance も active 一覧に含まれる', async () => {
		// findActiveOrUnclaimedByChildId が status=completed+rewardClaimed=0 を返す前提
		mockFindActiveOrUnclaimedByChildId.mockResolvedValueOnce([
			row({
				id: '10',
				childId: asChildId(902),
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 0,
			}),
		]);
		mockFindAllByTenant.mockResolvedValueOnce([
			row({
				id: '10',
				childId: asChildId(902),
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 0,
			}),
		]);
		const result = await getActiveChildChallengesWithSiblings(asChildId(902), TENANT);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe('10');
		expect(result[0]?.rewardClaimed).toBe(0);
		expect(result[0]?.completed).toBe(1);
		// ChallengeBanner の claim button が render されるための条件: completed=1 + rewardClaimed=0
	});

	it('must-2: 過去期間の同 sourceTemplateId instance は siblings[] から除外される', async () => {
		// 自身: 今週 (5/25 - 6/1) active
		mockFindActiveOrUnclaimedByChildId.mockResolvedValueOnce([
			row({ id: '100', childId: asChildId(902), startDate: '2026-05-25', endDate: '2026-06-01' }),
		]);
		// tenant 全体: 自身 + 兄弟今週 + 自身の先週 expired completed (sourceTemplateId 共有)
		mockFindAllByTenant.mockResolvedValueOnce([
			row({ id: '100', childId: asChildId(902), startDate: '2026-05-25', endDate: '2026-06-01' }),
			row({
				id: '101',
				childId: asChildId(903),
				startDate: '2026-05-25',
				endDate: '2026-06-01',
				currentValue: 2,
			}),
			// 先週分 (異なる期間) — siblings に含まれてはいけない
			row({
				id: '90',
				childId: asChildId(902),
				startDate: '2026-05-18',
				endDate: '2026-05-24',
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 1,
			}),
			row({
				id: '91',
				childId: asChildId(903),
				startDate: '2026-05-18',
				endDate: '2026-05-24',
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 1,
			}),
		]);
		const result = await getActiveChildChallengesWithSiblings(asChildId(902), TENANT);
		expect(result).toHaveLength(1);
		// siblings は今週分 2 件のみ (先週分 2 件は除外)
		expect(result[0]?.siblings).toHaveLength(2);
		expect(result[0]?.siblings.map((s) => s.id).sort()).toEqual(['100', '101']);
		// 今週分は誰も完了していない → allCompleted=false (誤 celebration 発火しない)
		expect(result[0]?.allCompleted).toBe(false);
	});

	it('must-2: 同期間のみで全 sibling completed → allCompleted=true (正常 celebration 発火)', async () => {
		mockFindActiveOrUnclaimedByChildId.mockResolvedValueOnce([
			row({
				id: '200',
				childId: asChildId(902),
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 0,
			}),
		]);
		mockFindAllByTenant.mockResolvedValueOnce([
			row({
				id: '200',
				childId: asChildId(902),
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 0,
			}),
			row({
				id: '201',
				childId: asChildId(903),
				status: 'completed',
				completed: 1,
				currentValue: 5,
				rewardClaimed: 1,
			}),
		]);
		const result = await getActiveChildChallengesWithSiblings(asChildId(902), TENANT);
		expect(result).toHaveLength(1);
		expect(result[0]?.allCompleted).toBe(true);
	});
});

// #3333 (C): claimChildChallengeReward の fail-closed gating + per-child 受取意図の回帰テスト。
// 設計意図 (確定根拠): 旧 ChallengeBanner は `completed===1 && rewardClaimed===0`（= 自身の instance
// 個別完了）で受取 form を出していた (#2488 must-1 コメント参照)。受取は per-child instance ごとで
// (ADR-0055 per-child 報酬モデル / claimChildChallengeReward は childId 一致 instance のみ claim)、
// 兄弟全完了 (allCompleted) を受取条件にしてはならない。server は以下を fail-closed で守る。
function challengeRow(over: Record<string, unknown> = {}) {
	return {
		id: '10',
		childId: asChildId(902),
		title: 'P',
		completed: 1,
		currentValue: 5,
		targetValue: 5,
		targetConfig: '{"metric":"count","categoryId":1,"baseTarget":5}',
		rewardConfig: '{"points":30,"message":"よくがんばったね"}',
		description: null,
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: '2026-05-25',
		endDate: '2026-06-01',
		status: 'completed',
		isActive: 1,
		completedAt: '2026-05-30T00:00:00Z',
		rewardClaimed: 0,
		rewardClaimedAt: null,
		sourceTemplateId: 'auto:weekly',
		createdAt: '',
		updatedAt: '',
		...over,
	};
}

describe('claimChildChallengeReward — 単一原子 primitive + fail-closed gating (#3284/#3342、#3333 後継)', () => {
	it('自身の instance が completed=1 && primitive が 1 を返す → 受取成功（兄弟未完了は無関係 = per-child）', async () => {
		mockFindById.mockResolvedValueOnce(challengeRow({ completed: 1, rewardClaimed: 0 }));
		mockClaimRewardAndGrantPoints.mockResolvedValueOnce(1); // flip + ledger insert が txn で成立
		const result = await claimChildChallengeReward('10', asChildId(902), TENANT);
		expect('points' in result && result.points).toBe(30);
		// flip + ledger を単一 primitive で実行 (service からの ledger 別呼び出しは撤去済 #3342 (1))
		expect(mockClaimRewardAndGrantPoints).toHaveBeenCalledTimes(1);
		expect(mockClaimRewardAndGrantPoints).toHaveBeenCalledWith(
			'10',
			expect.objectContaining({
				childId: asChildId(902),
				amount: 30,
				description: 'チャレンジ達成: P',
			}),
			TENANT,
		);
	});

	it('未完了 (completed=0) → 「まだクリアしていません」で fail-closed（primitive を呼ばない = 付与なし）', async () => {
		mockFindById.mockResolvedValueOnce(challengeRow({ completed: 0, currentValue: 2 }));
		const result = await claimChildChallengeReward('10', asChildId(902), TENANT);
		expect('error' in result && result.error).toBe('まだクリアしていません');
		expect(mockClaimRewardAndGrantPoints).not.toHaveBeenCalled();
	});

	it('既請求 (primitive が 0) → 「すでに受け取り済みです」で fail-closed（付与しない）', async () => {
		// findById は completed=1 を返すが、条件付き flip は既に flip 済のため 0 = 付与ごと skip
		mockFindById.mockResolvedValueOnce(challengeRow({ completed: 1, rewardClaimed: 1 }));
		mockClaimRewardAndGrantPoints.mockResolvedValueOnce(0);
		const result = await claimChildChallengeReward('10', asChildId(902), TENANT);
		expect('error' in result && result.error).toBe('すでに受け取り済みです');
	});

	it('別 child の instance (childId 不一致) → 受取拒否（IDOR fail-closed、primitive を呼ばない）', async () => {
		mockFindById.mockResolvedValueOnce(challengeRow({ childId: asChildId(903) }));
		const result = await claimChildChallengeReward('10', asChildId(902), TENANT);
		expect('error' in result && result.error).toBe('このチャレンジは別のお子さま用です');
		expect(mockClaimRewardAndGrantPoints).not.toHaveBeenCalled();
	});

	it('存在しない instance → 受取拒否', async () => {
		mockFindById.mockResolvedValueOnce(undefined);
		const result = await claimChildChallengeReward('999', asChildId(902), TENANT);
		expect('error' in result && result.error).toBe('チャレンジが見つかりません');
		expect(mockClaimRewardAndGrantPoints).not.toHaveBeenCalled();
	});

	// #3333 (3) TOCTOU 二重 claim 回帰 (#3284 で primitive 統合後も維持): mock を直列化せず、
	// 同一の completed&未請求 row を両 call が findById で読む状況を作る。原子 primitive は 1 回目
	// だけ flip + 付与 (=1)、2 回目は条件付きで 0 を返す。付与は primitive 内 txn に一体化して
	// いるため「flip 成功 = 付与 1 回」が構造保証される。
	it('並行 submit (race): primitive が 1→0 を返し、成功はちょうど 1 件', async () => {
		// 両 call とも findById は同じ completed=1 / rewardClaimed=0 の row を読む (TOCTOU 状況)
		mockFindById.mockResolvedValue(challengeRow({ completed: 1, rewardClaimed: 0 }));
		// 原子 primitive: 1 回目は flip + 付与 (=1)、2 回目以降は 0 (同一行を二度 flip しない)
		mockClaimRewardAndGrantPoints.mockResolvedValueOnce(1).mockResolvedValue(0);

		const [first, second] = await Promise.all([
			claimChildChallengeReward('10', asChildId(902), TENANT),
			claimChildChallengeReward('10', asChildId(902), TENANT),
		]);

		// 一方だけが成功し、他方は付与なしで「すでに受け取り済みです」
		const results = [first, second];
		const successes = results.filter(
			(r): r is { points: number; message?: string } => 'points' in r,
		);
		const failures = results.filter((r): r is { error: string } => 'error' in r);
		expect(successes).toHaveLength(1);
		expect(failures).toHaveLength(1);
		expect(successes[0]?.points).toBe(30);
		expect(failures[0]?.error).toBe('すでに受け取り済みです');

		// primitive 自体は両 submit で呼ばれる (原子化判定 + 付与は repo txn に委譲)
		expect(mockClaimRewardAndGrantPoints).toHaveBeenCalledTimes(2);
	});
});
