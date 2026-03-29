// tests/unit/services/email-service.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// SES クライアントのモック
const mockSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-ses', () => ({
	SESClient: class {
		send = mockSend;
	},
	SendEmailCommand: class {
		params: unknown;
		constructor(params: unknown) {
			this.params = params;
		}
	},
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
		SES_CONFIG_SET_NAME: 'ganbari-quest-config',
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// AUTH_MODE=cognito（本番モード）がデフォルト
import {
	sendCancellationEmail,
	sendDeletionCompleteEmail,
	sendEmail,
	sendInquiryConfirmationEmail,
	sendMemberJoinedEmail,
	sendMemberRemovedEmail,
	sendWelcomeEmail,
} from '$lib/server/services/email-service';

describe('email-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSend.mockResolvedValue({});
		process.env.AUTH_MODE = 'cognito';
	});

	describe('sendEmail', () => {
		it('SES経由でメールを送信する', async () => {
			const result = await sendEmail({
				to: 'test@example.com',
				subject: 'テスト件名',
				htmlBody: '<p>テスト本文</p>',
			});
			expect(result).toBe(true);
			expect(mockSend).toHaveBeenCalledTimes(1);
		});

		it('ローカルモードではSES送信をスキップする', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await sendEmail({
				to: 'test@example.com',
				subject: 'テスト',
				htmlBody: '<p>テスト</p>',
			});
			expect(result).toBe(true);
			expect(mockSend).not.toHaveBeenCalled();
		});

		it('SES送信失敗時にfalseを返す', async () => {
			mockSend.mockRejectedValueOnce(new Error('SES Error'));
			const result = await sendEmail({
				to: 'test@example.com',
				subject: 'テスト',
				htmlBody: '<p>テスト</p>',
			});
			expect(result).toBe(false);
		});
	});

	describe('sendWelcomeEmail', () => {
		it('ウェルカムメールを送信する', async () => {
			const result = await sendWelcomeEmail('user@example.com', '田中');
			expect(result).toBe(true);
			expect(mockSend).toHaveBeenCalledTimes(1);
		});
	});

	describe('sendInquiryConfirmationEmail', () => {
		it('問い合わせ受付確認メールを送信する', async () => {
			const result = await sendInquiryConfirmationEmail('user@example.com', 'INQ-20260329-001');
			expect(result).toBe(true);
			expect(mockSend).toHaveBeenCalledTimes(1);
		});
	});

	describe('sendCancellationEmail', () => {
		it('解約通知メールを送信する', async () => {
			const result = await sendCancellationEmail('user@example.com', '2026-04-28');
			expect(result).toBe(true);
		});
	});

	describe('sendDeletionCompleteEmail', () => {
		it('データ削除完了メールを送信する', async () => {
			const result = await sendDeletionCompleteEmail('user@example.com');
			expect(result).toBe(true);
		});
	});

	describe('sendMemberRemovedEmail', () => {
		it('メンバー除外通知メールを送信する', async () => {
			const result = await sendMemberRemovedEmail('user@example.com', '田中家');
			expect(result).toBe(true);
		});
	});

	describe('sendMemberJoinedEmail', () => {
		it('メンバー参加通知メールを送信する', async () => {
			const result = await sendMemberJoinedEmail('owner@example.com', '太郎', 'parent');
			expect(result).toBe(true);
		});
	});
});
