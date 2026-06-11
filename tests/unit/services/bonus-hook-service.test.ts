// tests/unit/services/bonus-hook-service.test.ts
// #2138 MP-3 / #2895: bonus rule hook の全件評価
//
// 検証対象 (#2895 はりぼて整理後、本番経路で発火する 5 preset):
//   streak-bonus / early-bird / weekend-special (2x) / category-challenge / self-study-reward。
// 撤去済 (発火しない rule を陳列しない、ADR-0013 LP truth):
//   - sibling-coop preset 全体 (allSiblingsActiveToday 永久不発 + 死蔵 rule)
//   - weekend-special `かぞくでチャレンジ` / self-study-reward `しんきかもくボーナス`
// `allSiblingsActiveToday` ctx field は撤去済 (本番 activity-log-service が常に false 固定だった)。

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks ----------

const mockLoadBonusOverrides = vi.fn();

// #2368 (ADR-0052 P3): bonus state SSOT が marketplace strategy 配下に移動したため新 path を mock。
// bonus-hook-service.ts は `$lib/marketplace/strategies/rule-preset/bonus-state` から
// loadBonusOverrides を import するため、ここで同じ specifier に対して mock を当てる。
vi.mock('$lib/marketplace/strategies/rule-preset/bonus-state', () => ({
	loadBonusOverrides: (...args: unknown[]) => mockLoadBonusOverrides(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	combineWithDefaultStreakBonus,
	evaluateBonusHooks,
} from '../../../src/lib/server/services/bonus-hook-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant-001';

function makePreset(presetId: string, rules: { title: string; pointBonus: number }[]) {
	return {
		presetId,
		presetName: presetId,
		presetIcon: '🔥',
		enabled: true,
		rules: rules.map((r) => ({ ...r, description: '', icon: '🔥' })),
		importedAt: '2026-05-01T00:00:00Z',
	};
}

function streakBonusPreset() {
	return makePreset('streak-bonus', [
		{ title: '3にちれんぞくボーナス', pointBonus: 10 },
		{ title: '7にちれんぞくボーナス', pointBonus: 30 },
		{ title: '30にちれんぞくボーナス', pointBonus: 100 },
	]);
}

function earlyBirdPreset() {
	return makePreset('early-bird', [
		{ title: 'はやおきボーナス', pointBonus: 5 },
		{ title: 'あさかつウィーク', pointBonus: 25 },
	]);
}

function weekendSpecialPreset() {
	return makePreset('weekend-special', [{ title: 'しゅうまつ2ばいボーナス', pointBonus: 0 }]);
}

function categoryChallengePreset() {
	return makePreset('category-challenge', [
		{ title: '3カテゴリチャレンジ', pointBonus: 15 },
		{ title: 'オールカテゴリチャレンジ', pointBonus: 50 },
	]);
}

function selfStudyRewardPreset() {
	return makePreset('self-study-reward', [
		{ title: 'じしゅがくしゅうボーナス', pointBonus: 10 },
		{ title: 'ウィークリー学習マスター', pointBonus: 30 },
	]);
}

// Fake datetime: 2026-05-13 (水曜) 06:00 JST -> early-bird 発火条件
const WEDNESDAY_EARLY = new Date('2026-05-13T06:00:00');
// 土曜 10:00 -> weekend
const SATURDAY_DAY = new Date('2026-05-16T10:00:00');
// 平日昼 -> early-bird 不発
const WEEKDAY_NOON = new Date('2026-05-13T12:00:00');

beforeEach(() => {
	vi.clearAllMocks();
	mockLoadBonusOverrides.mockResolvedValue({ presets: [] });
});

afterAll(() => {
	vi.restoreAllMocks();
});

// ==========================================================
// 取込済 preset 0 件 -> no-op (regression なし)
// ==========================================================

describe('evaluateBonusHooks - 取込なし', () => {
	it('取込済 preset なし -> totalBonus=0 / multiplier=1.0', async () => {
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 7,
				recordedAt: SATURDAY_DAY,
				todayDistinctCategoryCount: 5,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(0);
		expect(r.pointsMultiplier).toBe(1.0);
		expect(r.hits).toEqual([]);
	});
});

// ==========================================================
// 6 bonus rule 全件の発火検証 (AC3)
// ==========================================================

describe('evaluateBonusHooks - streak-bonus (1/5)', () => {
	it('3 日目で +10', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [streakBonusPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 3,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(10);
		expect(r.hits[0]?.presetId).toBe('streak-bonus');
		expect(r.hits[0]?.ruleTitle).toBe('3にちれんぞくボーナス');
	});

	it('7 日目で +30', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [streakBonusPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 7,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(30);
	});

	it('30 日目で +100', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [streakBonusPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 30,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(100);
	});

	it('isFirstToday=false -> 発火しない', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [streakBonusPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 7,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: false,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(0);
	});
});

describe('evaluateBonusHooks - early-bird (2/5)', () => {
	it('朝 6 時に記録 -> はやおきボーナス +5', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [earlyBirdPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: WEDNESDAY_EARLY,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(5);
	});

	it('昼に記録 -> 発火しない', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [earlyBirdPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(0);
	});

	it('朝 + 5 日連続 -> はやおき + あさかつウィーク = +30', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [earlyBirdPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 5,
				recordedAt: WEDNESDAY_EARLY,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(30);
		expect(r.hits.length).toBe(2);
	});
});

describe('evaluateBonusHooks - weekend-special (3/5)', () => {
	it('土曜 -> pointsMultiplier=2.0', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [weekendSpecialPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: SATURDAY_DAY,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.pointsMultiplier).toBe(2.0);
	});

	it('平日 -> 発火しない', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [weekendSpecialPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.pointsMultiplier).toBe(1.0);
		expect(r.totalBonus).toBe(0);
	});

	it('土曜 -> 2 倍のみ (かぞくでチャレンジ は #2895 で撤去、totalBonus は加算なし)', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [weekendSpecialPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: SATURDAY_DAY,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.pointsMultiplier).toBe(2.0);
		// 加点 rule は撤去済のため totalBonus は 0 (2x multiplier のみ)
		expect(r.totalBonus).toBe(0);
		expect(r.hits).toHaveLength(1);
	});
});

describe('evaluateBonusHooks - category-challenge (4/5)', () => {
	it('3 カテゴリ -> +15', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [categoryChallengePreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 3,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(15);
	});

	it('5 カテゴリ -> +50 (オールカテゴリ優先)', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [categoryChallengePreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 5,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(50);
	});

	it('2 カテゴリ -> 発火しない', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [categoryChallengePreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 2,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(0);
	});
});

describe('evaluateBonusHooks - self-study-reward (5/5)', () => {
	it('学習カテゴリ (categoryId=2) で活動 -> +10', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [selfStudyRewardPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 2,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(10);
	});

	it('学習カテゴリ + 5 日連続 -> ウィークリー +30 が追加で +40', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [selfStudyRewardPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 5,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 2,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(40);
	});

	it('運動カテゴリ -> 発火しない', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [selfStudyRewardPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 5,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(0);
	});
});

// ==========================================================
// enabled=false の preset は skip
// ==========================================================

describe('evaluateBonusHooks - enabled toggle', () => {
	it('enabled=false の preset は no-op', async () => {
		const preset = { ...streakBonusPreset(), enabled: false };
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [preset] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 7,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(0);
	});
});

// ==========================================================
// 複数 preset の合算
// ==========================================================

describe('evaluateBonusHooks - 複数 preset 合算', () => {
	it('streak + category 同時発火 -> 加算', async () => {
		mockLoadBonusOverrides.mockResolvedValueOnce({
			presets: [streakBonusPreset(), categoryChallengePreset()],
		});
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 3,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 5,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(10 + 50); // streak 3day + all-category
		expect(r.hits.length).toBe(2);
	});
});

// ==========================================================
// #2895 撤去済 / 未知 preset の forward-compat (既存テナントのデータ整合)
// ==========================================================

describe('evaluateBonusHooks - 撤去済 / 未知 preset の graceful skip', () => {
	it('撤去済 sibling-coop が settings KVS に残存していても throw せず no-op で skip', async () => {
		// #2895 で marketplace から撤去した sibling-coop を過去に取込済のテナントを再現。
		// switch の default 分岐で logger.warn + skip するため、bonus は付与されない。
		const legacy = makePreset('sibling-coop', [
			{ title: 'きょうだいいっしょボーナス', pointBonus: 10 },
			{ title: 'きょうだいおうえんボーナス', pointBonus: 5 },
		]);
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [legacy] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 1,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		expect(r.totalBonus).toBe(0);
		expect(r.pointsMultiplier).toBe(1.0);
		expect(r.hits).toEqual([]);
	});

	it('撤去済 preset + 存続 preset の混在 -> 存続分のみ評価', async () => {
		const legacy = makePreset('sibling-coop', [
			{ title: 'きょうだいいっしょボーナス', pointBonus: 10 },
		]);
		mockLoadBonusOverrides.mockResolvedValueOnce({ presets: [legacy, streakBonusPreset()] });
		const r = await evaluateBonusHooks(
			{
				consecutiveDays: 3,
				recordedAt: WEEKDAY_NOON,
				todayDistinctCategoryCount: 1,
				isFirstToday: true,
				categoryId: 1,
			},
			TENANT,
		);
		// streak-bonus 3day (+10) のみ。撤去済 sibling-coop は加算されない。
		expect(r.totalBonus).toBe(10);
		expect(r.hits.length).toBe(1);
		expect(r.hits[0]?.presetId).toBe('streak-bonus');
	});
});

// ==========================================================
// combineWithDefaultStreakBonus (既存 calcStreakBonus との合算 helper)
// ==========================================================

describe('combineWithDefaultStreakBonus', () => {
	it('既存 calcStreakBonus + hook 合算', () => {
		// calcStreakBonus(3) = min(3-1, 10) = 2
		const combined = combineWithDefaultStreakBonus(3, {
			totalBonus: 10,
			pointsMultiplier: 1.0,
			hits: [],
		});
		expect(combined).toBe(12);
	});

	it('hook 0 件 -> 既存値のまま', () => {
		const combined = combineWithDefaultStreakBonus(7, {
			totalBonus: 0,
			pointsMultiplier: 1.0,
			hits: [],
		});
		expect(combined).toBe(6); // calcStreakBonus(7) = min(7-1, 10) = 6
	});
});
