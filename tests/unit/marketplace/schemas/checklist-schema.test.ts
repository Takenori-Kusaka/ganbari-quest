/**
 * Issue #2364: ChecklistPayloadSchema Valibot 単体テスト
 */

import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { ChecklistPayloadSchema } from '$lib/marketplace/schemas/checklist-schema.js';

describe('ChecklistPayloadSchema', () => {
	test('valid payload (morning timing) で success', () => {
		const result = v.safeParse(ChecklistPayloadSchema, {
			timing: 'morning',
			items: [
				{ label: 'はみがき', icon: '🦷', order: 0 },
				{ label: '着替え', icon: '👕', order: 1 },
				{ label: 'ランドセル準備', icon: '🎒', order: 2 },
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.timing).toBe('morning');
			expect(result.output.items).toHaveLength(3);
		}
	});

	test('全 timing 種別 (5 種) で success', () => {
		const timings = ['morning', 'evening', 'weekend', 'daily', 'weekly'] as const;
		for (const timing of timings) {
			const result = v.safeParse(ChecklistPayloadSchema, {
				timing,
				items: [{ label: 'X', icon: '✅', order: 0 }],
			});
			expect(result.success, `timing=${timing} should succeed`).toBe(true);
		}
	});

	test('未知 timing で fail', () => {
		const result = v.safeParse(ChecklistPayloadSchema, {
			timing: 'midnight',
			items: [{ label: 'X', icon: '✅', order: 0 }],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.');
			expect(path).toContain('timing');
		}
	});

	test('空 items 配列で fail', () => {
		const result = v.safeParse(ChecklistPayloadSchema, {
			timing: 'morning',
			items: [],
		});
		expect(result.success).toBe(false);
	});

	test('order が負数で fail', () => {
		const result = v.safeParse(ChecklistPayloadSchema, {
			timing: 'morning',
			items: [{ label: 'X', icon: '✅', order: -1 }],
		});
		expect(result.success).toBe(false);
	});
});
