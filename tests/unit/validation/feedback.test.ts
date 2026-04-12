import { describe, expect, it } from 'vitest';
import {
	FEEDBACK_CATEGORIES,
	FEEDBACK_CATEGORY_LABELS,
	feedbackSchema,
} from '$lib/domain/validation/feedback';

describe('feedback validation', () => {
	describe('feedbackSchema', () => {
		it('valid feedback passes', () => {
			const result = feedbackSchema.safeParse({
				category: 'opinion',
				text: 'This is feedback',
				currentUrl: '/admin/settings',
			});
			expect(result.success).toBe(true);
		});

		it('all categories are accepted', () => {
			for (const category of FEEDBACK_CATEGORIES) {
				const result = feedbackSchema.safeParse({
					category,
					text: 'Test feedback',
				});
				expect(result.success).toBe(true);
			}
		});

		it('rejects invalid category', () => {
			const result = feedbackSchema.safeParse({
				category: 'invalid',
				text: 'Test',
			});
			expect(result.success).toBe(false);
		});

		it('rejects empty text', () => {
			const result = feedbackSchema.safeParse({
				category: 'bug',
				text: '',
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.message).toContain('入力してください');
			}
		});

		it('rejects text over 1000 characters', () => {
			const result = feedbackSchema.safeParse({
				category: 'bug',
				text: 'a'.repeat(1001),
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.message).toContain('1000文字以内');
			}
		});

		it('accepts text exactly 1000 characters', () => {
			const result = feedbackSchema.safeParse({
				category: 'feature',
				text: 'a'.repeat(1000),
			});
			expect(result.success).toBe(true);
		});

		it('currentUrl is optional', () => {
			const result = feedbackSchema.safeParse({
				category: 'other',
				text: 'Test feedback',
			});
			expect(result.success).toBe(true);
		});
	});

	describe('FEEDBACK_CATEGORY_LABELS', () => {
		it('all categories have labels', () => {
			for (const category of FEEDBACK_CATEGORIES) {
				expect(FEEDBACK_CATEGORY_LABELS[category]).toBeTruthy();
			}
		});
	});
});
