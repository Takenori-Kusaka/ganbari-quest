// tests/unit/routes/support-feedback-action.test.ts
// #3210: 統合サポートフォーム sendFeedback action の data-loss / 偽成功 根治の回帰テスト。
//
// 観点:
// - saveInquiry 成功 → { feedbackSuccess: true } を返す (feedback / consult)
// - saveInquiry 失敗 → fail(500, { feedbackError }) を返し、success を偽装しない
//   (DB save 失敗を握り潰して「受付完了」と誤認させない = data-loss 根治)
// - save 失敗時も Discord (notifyInquiry) は best-effort backup として呼ばれる

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateInquiryId = vi.fn();
const mockSaveInquiry = vi.fn();
vi.mock('$lib/server/db/inquiry-repo', () => ({
	generateInquiryId: (...args: unknown[]) => mockGenerateInquiryId(...args),
	saveInquiry: (...args: unknown[]) => mockSaveInquiry(...args),
}));

const mockNotifyInquiry = vi.fn();
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyInquiry: (...args: unknown[]) => mockNotifyInquiry(...args),
}));

const mockSendConfirmation = vi.fn();
vi.mock('$lib/server/services/email-service', () => ({
	sendInquiryConfirmationEmail: (...args: unknown[]) => mockSendConfirmation(...args),
}));

vi.mock('$lib/server/services/analytics-service', () => ({ trackBusinessEvent: vi.fn() }));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { actions } = await import(
	'../../../src/routes/(parent)/admin/settings/support/+page.server'
);

type ActionEvent = Parameters<(typeof actions)['sendFeedback']>[0];

function createEvent(form: Record<string, string>, tenantId = 't-test'): ActionEvent {
	const fd = new FormData();
	for (const [k, v] of Object.entries(form)) fd.set(k, v);
	return {
		request: { formData: async () => fd },
		locals: { context: { tenantId } },
	} as unknown as ActionEvent;
}

describe('sendFeedback action — saveInquiry 失敗の surface (#3210)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateInquiryId.mockResolvedValue('INQ-TEST');
		mockSaveInquiry.mockResolvedValue(undefined);
		mockNotifyInquiry.mockReturnValue(Promise.resolve());
		mockSendConfirmation.mockReturnValue(Promise.resolve());
	});

	it('feedback intent: save 成功で feedbackSuccess=true を返す', async () => {
		const result = (await actions.sendFeedback(
			createEvent({ intent: 'feedback', category: 'bug', text: 'バグ報告です' }),
		)) as { feedbackSuccess?: boolean; inquiryId?: string };
		expect(result.feedbackSuccess).toBe(true);
		expect(result.inquiryId).toBe('INQ-TEST');
		expect(mockSaveInquiry).toHaveBeenCalledTimes(1);
	});

	it('consult intent: save 成功で feedbackSuccess=true を返す', async () => {
		const result = (await actions.sendFeedback(
			createEvent({
				intent: 'consult',
				text: '解約を検討しています',
				email: 'parent@example.com',
				childAge: '7 歳',
			}),
		)) as { feedbackSuccess?: boolean; intent?: string };
		expect(result.feedbackSuccess).toBe(true);
		expect(result.intent).toBe('consult');
	});

	it('save 失敗時は fail(500) を返し success を偽装しない (data-loss 根治)', async () => {
		mockSaveInquiry.mockRejectedValue(new Error('db down'));
		const result = (await actions.sendFeedback(
			createEvent({ intent: 'feedback', category: 'bug', text: 'バグ報告です' }),
		)) as { status?: number; data?: { feedbackError?: string }; feedbackSuccess?: boolean };
		expect(result.status).toBe(500);
		expect(result.data?.feedbackError).toBeTruthy();
		// 偽成功を返していない
		expect(result.feedbackSuccess).toBeUndefined();
	});

	it('consult の save 失敗も fail(500) を返す (解約相談の消失を防ぐ)', async () => {
		mockSaveInquiry.mockRejectedValue(new Error('db down'));
		const result = (await actions.sendFeedback(
			createEvent({ intent: 'consult', text: '解約相談', email: 'parent@example.com' }),
		)) as { status?: number; feedbackSuccess?: boolean };
		expect(result.status).toBe(500);
		expect(result.feedbackSuccess).toBeUndefined();
	});

	it('save 失敗時も Discord (notifyInquiry) は best-effort backup として呼ばれる', async () => {
		mockSaveInquiry.mockRejectedValue(new Error('db down'));
		await actions.sendFeedback(
			createEvent({ intent: 'feedback', category: 'other', text: 'バックアップ通知の確認' }),
		);
		expect(mockNotifyInquiry).toHaveBeenCalledTimes(1);
	});
});
