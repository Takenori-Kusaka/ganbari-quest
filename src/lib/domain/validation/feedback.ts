import { z } from 'zod';

export const FEEDBACK_CATEGORIES = ['opinion', 'bug', 'feature', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
	opinion: 'ご意見',
	bug: '不具合報告',
	feature: '機能要望',
	other: 'その他',
};

export const feedbackSchema = z.object({
	category: z.enum(FEEDBACK_CATEGORIES),
	text: z
		.string()
		.min(1, 'フィードバック内容を入力してください')
		.max(1000, 'フィードバックは1000文字以内で入力してください'),
	currentUrl: z.string().max(500).optional(),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
