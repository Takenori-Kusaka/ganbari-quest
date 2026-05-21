/**
 * Issue #2364: RulePresetPayloadSchema Valibot 単体テスト
 */

import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { RulePresetPayloadSchema } from '$lib/marketplace/schemas/rule-preset-schema.js';

describe('RulePresetPayloadSchema', () => {
	test('exchange ruleType + pointCost で success', () => {
		const result = v.safeParse(RulePresetPayloadSchema, {
			ruleType: 'exchange',
			rules: [
				{
					title: '30 分ゲームと交換',
					description: '50 pt で 30 分ゲーム時間と交換できる',
					icon: '🎮',
					pointCost: 50,
				},
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.ruleType).toBe('exchange');
			expect(result.output.rules[0]?.pointCost).toBe(50);
		}
	});

	test('bonus ruleType + pointBonus で success', () => {
		const result = v.safeParse(RulePresetPayloadSchema, {
			ruleType: 'bonus',
			rules: [
				{
					title: '連続 7 日達成ボーナス',
					description: '7 日連続で達成すると +100 pt',
					icon: '🔥',
					pointBonus: 100,
				},
			],
		});
		expect(result.success).toBe(true);
	});

	test('全 4 ruleType で success', () => {
		const types = ['exchange', 'bonus', 'penalty', 'special'] as const;
		for (const ruleType of types) {
			const result = v.safeParse(RulePresetPayloadSchema, {
				ruleType,
				rules: [{ title: 'X', description: 'Y', icon: '📜' }],
			});
			expect(result.success, `ruleType=${ruleType} should succeed`).toBe(true);
		}
	});

	test('未知 ruleType で fail', () => {
		const result = v.safeParse(RulePresetPayloadSchema, {
			ruleType: 'invalid',
			rules: [{ title: 'X', description: 'Y', icon: '📜' }],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.');
			expect(path).toContain('ruleType');
		}
	});

	test('description 空文字で fail', () => {
		const result = v.safeParse(RulePresetPayloadSchema, {
			ruleType: 'exchange',
			rules: [{ title: 'X', description: '', icon: '📜' }],
		});
		expect(result.success).toBe(false);
	});

	test('空 rules 配列で fail', () => {
		const result = v.safeParse(RulePresetPayloadSchema, {
			ruleType: 'exchange',
			rules: [],
		});
		expect(result.success).toBe(false);
	});
});
