/**
 * Issue #2364: ActivityPackPayloadSchema Valibot 単体テスト
 */

import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { ActivityPackPayloadSchema } from '$lib/marketplace/schemas/activity-pack-schema.js';

describe('ActivityPackPayloadSchema', () => {
	test('valid payload 1 件で success', () => {
		const result = v.safeParse(ActivityPackPayloadSchema, {
			activities: [
				{
					name: 'うがい・手洗い',
					categoryCode: 'seikatsu',
					icon: '🤲',
					basePoints: 10,
					ageMin: 3,
					ageMax: 12,
					gradeLevel: 'kinder',
				},
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.activities[0]?.name).toBe('うがい・手洗い');
		}
	});

	test('mustDefault / triggerHint / description optional が省略可能', () => {
		const result = v.safeParse(ActivityPackPayloadSchema, {
			activities: [
				{
					name: 'よみかきれんしゅう',
					categoryCode: 'benkyou',
					icon: '📚',
					basePoints: 20,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
				},
			],
		});
		expect(result.success).toBe(true);
	});

	test('mustDefault: true を許容', () => {
		const result = v.safeParse(ActivityPackPayloadSchema, {
			activities: [
				{
					name: 'はみがき',
					categoryCode: 'seikatsu',
					icon: '🦷',
					basePoints: 5,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
					mustDefault: true,
				},
			],
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.output.activities[0]?.mustDefault).toBe(true);
	});

	test('空 activities 配列で fail', () => {
		const result = v.safeParse(ActivityPackPayloadSchema, { activities: [] });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.path?.[0]?.key === 'activities')).toBe(true);
		}
	});

	test('未知 categoryCode で fail (path 明確)', () => {
		const result = v.safeParse(ActivityPackPayloadSchema, {
			activities: [
				{
					name: 'ジョギング',
					categoryCode: 'unknown',
					icon: '🏃',
					basePoints: 10,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
				},
			],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.');
			expect(path).toContain('categoryCode');
		}
	});

	test('basePoints が範囲外 (0) で fail', () => {
		const result = v.safeParse(ActivityPackPayloadSchema, {
			activities: [
				{
					name: 'X',
					categoryCode: 'undou',
					icon: '⚽',
					basePoints: 0,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
				},
			],
		});
		expect(result.success).toBe(false);
	});

	test('name が空文字で fail', () => {
		const result = v.safeParse(ActivityPackPayloadSchema, {
			activities: [
				{
					name: '',
					categoryCode: 'undou',
					icon: '⚽',
					basePoints: 5,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
				},
			],
		});
		expect(result.success).toBe(false);
	});
});
