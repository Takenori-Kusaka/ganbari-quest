// tests/unit/services/challenge-generation.test.ts
// チャレンジ生成アルゴリズム (純粋ロジック) の検証。
// #3194 で auto-challenge-service に実装 → #3213 で challenge-generation 共有モジュールへ移設。

import { describe, expect, it } from 'vitest';
import {
	type ChallengePrev,
	computeProposal,
	getLastWeekStart,
	getWeekEnd,
	getWeekStart,
	summarizeChallengeAnalytics,
} from '$lib/server/services/challenge-generation';

// computeProposal は (counts, prev, weekStart) を取る純粋関数。
// weekIndexOf(weekStart) % 4 === 0 を「得意週」とするため weekStart は週インデックスで選ぶ。
const WEEK_WEAKNESS = '2026-01-05'; // 非得意週 (weekIndex % 4 !== 0)
const STRENGTH_WEEK = '2026-01-19'; // weekIndex % 4 === 0 → 得意週

function counts(byId: Record<number, number>): Record<number, number> {
	return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...byId };
}
function makePrev(over: Partial<ChallengePrev> = {}): ChallengePrev {
	return {
		categoryId: 2,
		status: 'expired',
		currentCount: 0,
		targetCount: 3,
		consecutiveMissCount: 0,
		...over,
	};
}

describe('getWeekStart / getLastWeekStart / getWeekEnd', () => {
	it('returns Monday for given dates', () => {
		expect(getWeekStart(new Date(2026, 3, 6))).toBe('2026-04-06'); // Mon
		expect(getWeekStart(new Date(2026, 3, 8))).toBe('2026-04-06'); // Wed → prev Mon
		expect(getWeekStart(new Date(2026, 3, 12))).toBe('2026-04-06'); // Sun → prev Mon
	});
	it('getLastWeekStart / getWeekEnd', () => {
		expect(getLastWeekStart('2026-04-06')).toBe('2026-03-30');
		expect(getWeekEnd('2026-04-06')).toBe('2026-04-12'); // Sunday
	});
});

describe('computeProposal — カテゴリ選択 (§3.4)', () => {
	it('データ不足なら explore モード (target=最小2)', () => {
		const p = computeProposal(counts({ 1: 2 }), undefined, WEEK_WEAKNESS);
		expect(p.mode).toBe('explore');
		expect(p.targetCount).toBe(2);
		expect(p.reason).toContain('まだ記録が少ない');
	});

	it('通常週は weakness モード (target は 2〜7)', () => {
		const p = computeProposal(counts({ 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 }), undefined, WEEK_WEAKNESS);
		expect(p.mode).toBe('weakness');
		expect(p.targetCount).toBeGreaterThanOrEqual(2);
		expect(p.targetCount).toBeLessThanOrEqual(7);
		expect(p.consecutiveMissCount).toBe(0);
	});

	it('得意週は strength モードで最多カテゴリを選ぶ', () => {
		const p = computeProposal(counts({ 1: 8, 5: 0 }), undefined, STRENGTH_WEEK);
		expect(p.mode).toBe('strength');
		expect(p.categoryId).toBe(1);
		expect(p.targetCount).toBe(5); // avg 4 → clamp(5,2,7)
	});
});

describe('computeProposal — 翌週適応 (Flow 3 分岐)', () => {
	it('前週完了 + 大幅超過なら target を上げる (+2)', () => {
		const prev = makePrev({ categoryId: 1, status: 'completed', targetCount: 5, currentCount: 7 });
		const p = computeProposal(counts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.categoryId).toBe(1);
		expect(p.targetCount).toBe(7); // max(base3, 5+2)
	});

	it('前週未達 (半分以上) なら据え置き', () => {
		const prev = makePrev({ categoryId: 1, status: 'expired', targetCount: 5, currentCount: 3 });
		const p = computeProposal(counts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.targetCount).toBe(5);
		expect(p.consecutiveMissCount).toBe(1);
	});

	it('前週未達 (半分未満) なら 1 下げる', () => {
		const prev = makePrev({ categoryId: 1, status: 'expired', targetCount: 5, currentCount: 1 });
		const p = computeProposal(counts({ 1: 4 }), prev, STRENGTH_WEEK);
		expect(p.targetCount).toBe(4);
	});

	it('2 週連続未達なら rescue-strength (target 最小 + 得意カテゴリ)', () => {
		const prev = makePrev({
			categoryId: 2,
			status: 'expired',
			consecutiveMissCount: 1,
			targetCount: 3,
			currentCount: 0,
		});
		const p = computeProposal(counts({ 1: 6 }), prev, WEEK_WEAKNESS);
		expect(p.mode).toBe('rescue-strength');
		expect(p.categoryId).toBe(1);
		expect(p.targetCount).toBe(2);
		expect(p.consecutiveMissCount).toBe(2);
	});

	it('前週完了なら連続未達カウントは 0 にリセット', () => {
		const prev = makePrev({ status: 'completed', consecutiveMissCount: 3 });
		const p = computeProposal(counts({ 1: 8, 2: 4 }), prev, WEEK_WEAKNESS);
		expect(p.consecutiveMissCount).toBe(0);
	});
});

describe('summarizeChallengeAnalytics', () => {
	function row(over: Partial<Parameters<typeof summarizeChallengeAnalytics>[0][number]>) {
		return {
			categoryId: 1,
			status: 'expired',
			currentCount: 0,
			targetCount: 3,
			mode: 'weakness',
			consecutiveMissCount: 0,
			...over,
		};
	}

	it('空リストは全指標 0', () => {
		const a = summarizeChallengeAnalytics([]);
		expect(a.totalWeeks).toBe(0);
		expect(a.completionRate).toBe(0);
		expect(a.consecutiveMissRate).toBe(0);
	});

	it('達成率 / 超過度 / 得意週vs苦手週 を算出する', () => {
		const a = summarizeChallengeAnalytics([
			row({
				categoryId: 1,
				status: 'completed',
				targetCount: 3,
				currentCount: 5,
				mode: 'weakness',
			}),
			row({ categoryId: 1, status: 'expired', targetCount: 4, currentCount: 1, mode: 'weakness' }),
			row({
				categoryId: 2,
				status: 'completed',
				targetCount: 2,
				currentCount: 2,
				mode: 'strength',
			}),
			row({ categoryId: 3, status: 'expired', consecutiveMissCount: 2, mode: 'weakness' }),
		]);
		expect(a.totalWeeks).toBe(4);
		expect(a.completionRate).toBe(0.5);
		expect(a.completionRateByCategory[1]).toBe(0.5);
		expect(a.avgOvershoot).toBe(1);
		expect(a.consecutiveMissRate).toBe(0.25);
		expect(a.strengthCompletionRate).toBe(1);
		expect(a.weaknessCompletionRate).toBeCloseTo(1 / 3);
	});
});
