/**
 * Issue #2364: RewardSetPayloadSchema Valibot 単体テスト
 */

import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { RewardSetPayloadSchema } from '$lib/marketplace/schemas/reward-set-schema.js';

describe('RewardSetPayloadSchema', () => {
	test('valid payload で success', () => {
		const result = v.safeParse(RewardSetPayloadSchema, {
			rewards: [
				{ title: 'アイス', points: 50, icon: '🍦', category: 'life' },
				{
					title: 'おでかけ',
					points: 200,
					icon: '🚗',
					category: 'social',
					description: '家族でおでかけ',
				},
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.rewards).toHaveLength(2);
			expect(result.output.rewards[1]?.description).toBe('家族でおでかけ');
		}
	});

	test('description optional 省略可能', () => {
		const result = v.safeParse(RewardSetPayloadSchema, {
			rewards: [{ title: 'X', points: 10, icon: '🎁', category: 'other' }],
		});
		expect(result.success).toBe(true);
	});

	test('未知 category で fail', () => {
		const result = v.safeParse(RewardSetPayloadSchema, {
			rewards: [{ title: 'X', points: 10, icon: '🎁', category: 'invalid-cat' }],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.');
			expect(path).toContain('category');
		}
	});

	test('空 rewards 配列で fail', () => {
		const result = v.safeParse(RewardSetPayloadSchema, { rewards: [] });
		expect(result.success).toBe(false);
	});

	test('points 範囲外 (負数) で fail', () => {
		const result = v.safeParse(RewardSetPayloadSchema, {
			rewards: [{ title: 'X', points: -5, icon: '🎁', category: 'other' }],
		});
		expect(result.success).toBe(false);
	});
});
