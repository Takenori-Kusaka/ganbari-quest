// tests/unit/domain/preset-challenges.test.ts
// #2298 (EPIC #2294 ④): プリセット家族チャレンジカタログのスキーマ整合性 / 日付解決テスト

import { describe, expect, it } from 'vitest';
import {
	getAutoAddRecommendedPresets,
	getPresetChallengeById,
	PRESET_CHALLENGES,
	type PresetChallenge,
	resolvePresetChallengeDates,
} from '$lib/data/preset-challenges';

describe('PRESET_CHALLENGES — Issue #2298 AC1', () => {
	it('5-7 件のプリセットが定義されている (AC1)', () => {
		expect(PRESET_CHALLENGES.length).toBeGreaterThanOrEqual(5);
		expect(PRESET_CHALLENGES.length).toBeLessThanOrEqual(7);
	});

	it('全 preset に必須 field がある', () => {
		for (const p of PRESET_CHALLENGES) {
			expect(p.id).not.toBe('');
			expect(p.title).not.toBe('');
			expect(p.description).not.toBe('');
			expect(p.startMonthDay).not.toBe('');
			expect(p.endMonthDay).not.toBe('');
			expect(p.baseTarget).toBeGreaterThanOrEqual(1);
			expect(p.rewardPoints).toBeGreaterThanOrEqual(1);
			expect(p.icon).not.toBe('');
			expect(typeof p.autoAddRecommended).toBe('boolean');
		}
	});

	it('id が unique', () => {
		const ids = PRESET_CHALLENGES.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('日本ローカライズ 5 件が含まれる (ひな祭り / こどもの日 / 七夕 / 夏休み読書 / 敬老の日)', () => {
		const expectedJpIds = [
			'preset-hinamatsuri',
			'preset-kodomonohi',
			'preset-tanabata',
			'preset-natsuyasumi-reading',
			'preset-keironohi',
		];
		const allIds = PRESET_CHALLENGES.map((p) => p.id);
		for (const id of expectedJpIds) {
			expect(allIds).toContain(id);
		}
	});

	it('categoryId は null または 1-5 (validation/activity.ts CATEGORIES 整合)', () => {
		for (const p of PRESET_CHALLENGES) {
			if (p.categoryId !== null) {
				expect(p.categoryId).toBeGreaterThanOrEqual(1);
				expect(p.categoryId).toBeLessThanOrEqual(5);
			}
		}
	});
});

describe('getAutoAddRecommendedPresets — AC3 auto-add 3 件', () => {
	it('autoAddRecommended が 3 件存在する (Issue #2298 設計方針 auto-add 3 件)', () => {
		const recommended = getAutoAddRecommendedPresets();
		expect(recommended).toHaveLength(3);
	});

	it('返される preset は全て autoAddRecommended=true', () => {
		const recommended = getAutoAddRecommendedPresets();
		for (const p of recommended) {
			expect(p.autoAddRecommended).toBe(true);
		}
	});
});

describe('getPresetChallengeById', () => {
	it('既存 id で正しい preset を返す', () => {
		const p = getPresetChallengeById('preset-hinamatsuri');
		expect(p).toBeDefined();
		expect(p?.title).toBe('ひな祭り大掃除チャレンジ');
	});

	it('存在しない id で undefined を返す', () => {
		expect(getPresetChallengeById('preset-nonexistent')).toBeUndefined();
	});
});

describe('resolvePresetChallengeDates — 日付解決', () => {
	function buildPreset(overrides: Partial<PresetChallenge>): PresetChallenge {
		return {
			id: 'test',
			title: 'test',
			description: 'test',
			startMonthDay: '01-01',
			endMonthDay: '01-31',
			baseTarget: 1,
			categoryId: null,
			rewardPoints: 10,
			icon: '🎯',
			autoAddRecommended: false,
			...overrides,
		};
	}

	it('MM-DD 形式: 未来日付は当年に解決される', () => {
		const now = new Date(2026, 0, 15); // 2026-01-15
		const result = resolvePresetChallengeDates(
			buildPreset({ startMonthDay: '03-01', endMonthDay: '03-03' }),
			now,
		);
		expect(result.startDate).toBe('2026-03-01');
		expect(result.endDate).toBe('2026-03-03');
	});

	it('MM-DD 形式: 過去日付は来年に shift される', () => {
		const now = new Date(2026, 5, 1); // 2026-06-01
		const result = resolvePresetChallengeDates(
			buildPreset({ startMonthDay: '03-01', endMonthDay: '03-03' }),
			now,
		);
		// startDate が来年なら endDate も同じ来年
		expect(result.startDate).toBe('2027-03-01');
		expect(result.endDate).toBe('2027-03-03');
	});

	it('this-month-start / this-month-end: 今月初日 / 末日', () => {
		const now = new Date(2026, 1, 15); // 2026-02-15 (閏年ではない 2026 年 2 月)
		const result = resolvePresetChallengeDates(
			buildPreset({ startMonthDay: 'this-month-start', endMonthDay: 'this-month-end' }),
			now,
		);
		expect(result.startDate).toBe('2026-02-01');
		expect(result.endDate).toBe('2026-02-28');
	});

	it('today / today-plus-7: 7 日後', () => {
		const now = new Date(2026, 4, 18); // 2026-05-18
		const result = resolvePresetChallengeDates(
			buildPreset({ startMonthDay: 'today', endMonthDay: 'today-plus-7' }),
			now,
		);
		expect(result.startDate).toBe('2026-05-18');
		expect(result.endDate).toBe('2026-05-25');
	});

	it('startDate <= endDate を常に満たす', () => {
		const now = new Date();
		for (const p of PRESET_CHALLENGES) {
			const { startDate, endDate } = resolvePresetChallengeDates(p, now);
			expect(startDate <= endDate).toBe(true);
		}
	});
});
