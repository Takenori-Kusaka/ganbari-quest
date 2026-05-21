/**
 * Issue #2364: ChallengeSetPayloadSchema Valibot 単体テスト
 */

import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { ChallengeSetPayloadSchema } from '$lib/marketplace/schemas/challenge-set-schema.js';

describe('ChallengeSetPayloadSchema', () => {
	test('cooperative weekly challenge で success', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'きょうだいで掃除週間',
					description: '今週は二人で部屋掃除を 5 回達成しよう',
					icon: '🧹',
					challengeType: 'cooperative',
					periodType: 'weekly',
					categoryCode: 'seikatsu',
					targetCount: 5,
					rewardPoints: 100,
				},
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.challenges[0]?.challengeType).toBe('cooperative');
		}
	});

	test('competitive monthly challenge で success', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: '今月の運動王',
					icon: '🏃',
					challengeType: 'competitive',
					periodType: 'monthly',
					targetCount: 30,
					rewardPoints: 500,
				},
			],
		});
		expect(result.success).toBe(true);
	});

	test('description / categoryCode optional 省略可能', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'デイリーチャレンジ',
					icon: '⭐',
					challengeType: 'cooperative',
					periodType: 'daily',
					targetCount: 1,
					rewardPoints: 10,
				},
			],
		});
		expect(result.success).toBe(true);
	});

	test('未知 challengeType で fail', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'X',
					icon: '⭐',
					challengeType: 'rivalry',
					periodType: 'weekly',
					targetCount: 5,
					rewardPoints: 100,
				},
			],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.');
			expect(path).toContain('challengeType');
		}
	});

	test('未知 periodType で fail', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'X',
					icon: '⭐',
					challengeType: 'cooperative',
					periodType: 'yearly',
					targetCount: 5,
					rewardPoints: 100,
				},
			],
		});
		expect(result.success).toBe(false);
	});

	test('targetCount が 0 で fail', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, {
			challenges: [
				{
					title: 'X',
					icon: '⭐',
					challengeType: 'cooperative',
					periodType: 'weekly',
					targetCount: 0,
					rewardPoints: 100,
				},
			],
		});
		expect(result.success).toBe(false);
	});

	test('空 challenges 配列で fail', () => {
		const result = v.safeParse(ChallengeSetPayloadSchema, { challenges: [] });
		expect(result.success).toBe(false);
	});
});
