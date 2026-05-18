// tests/unit/services/email-deliverability.test.ts
// #2192 AC2/AC3: SES デリバラビリティ (sender / config set / error handling) ユニット
//
// 既存 `email-service.test.ts` 15 件は各メール template の成功発火を網羅するが、
// 本 spec は AC2 (SES sender ID / DKIM / SPF 配布証跡) + AC3 (バウンス処理 / エラーハンドリング)
// を構造的に検証する。
//
// 設計意図:
//   - DKIM / SPF / IAM 権限は AWS Console 側設定なので unit からは検証不可。
//     代わりに「SES_SENDER_EMAIL / SES_CONFIG_SET_NAME env が email-service.ts で
//     正しく参照される」「SendEmailCommand に渡される Source / ConfigurationSetName が
//     env 値と一致する」を検証する (配布証跡 unit-level)。
//   - エラーハンドリング (AC3) は SendEmailCommand が throw した時に
//     `email-service.sendEmail` が false を返す + logger.error 経由で記録することを検証。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SES クライアントのモック (mockSend は describe 跨ぎで状態保持するため module scope)
const mockSend = vi.fn();
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
	SendRawEmailCommand: class {
		params: unknown;
		constructor(params: unknown) {
			this.params = params;
		}
	},
}));

// $env/dynamic/private は import 時固定なので mock を分けて env 値別 sub-suite を作る
vi.mock('$env/dynamic/private', () => ({
	env: {
		SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
		SES_CONFIG_SET_NAME: 'ganbari-quest-default',
	},
}));

const { mockLoggerError, mockLoggerInfo } = vi.hoisted(() => ({
	mockLoggerError: vi.fn(),
	mockLoggerInfo: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: {
		info: mockLoggerInfo,
		warn: vi.fn(),
		error: mockLoggerError,
	},
}));

import { sendEmail, sendWelcomeEmail } from '$lib/server/services/email-service';

describe('#2192 AC2 SES sender / config set — env 配布証跡', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSend.mockReset();
		mockSend.mockResolvedValue({});
		process.env.AUTH_MODE = 'cognito';
	});

	afterEach(() => {
		delete process.env.AUTH_MODE;
	});

	it('AC2-1: SES_SENDER_EMAIL env 値が Source に注入される', async () => {
		await sendEmail({
			to: 'recipient@example.com',
			subject: 'AC2 検証',
			htmlBody: '<p>本文</p>',
		});

		expect(mockSend).toHaveBeenCalledTimes(1);
		const cmd = mockSend.mock.calls[0]?.[0];
		expect(cmd.params.Source).toBe('がんばりクエスト <noreply@ganbari-quest.com>');
	});

	it('AC2-2: SES_CONFIG_SET_NAME env 値が ConfigurationSetName に注入される', async () => {
		await sendEmail({
			to: 'recipient@example.com',
			subject: 'AC2 検証',
			htmlBody: '<p>本文</p>',
		});

		const cmd = mockSend.mock.calls[0]?.[0];
		expect(cmd.params.ConfigurationSetName).toBe('ganbari-quest-default');
	});

	it('AC2-3: 受信先アドレスが Destination.ToAddresses に正しく入る', async () => {
		await sendEmail({
			to: 'recipient@example.com',
			subject: 'AC2 検証',
			htmlBody: '<p>本文</p>',
		});

		const cmd = mockSend.mock.calls[0]?.[0];
		expect(cmd.params.Destination.ToAddresses).toEqual(['recipient@example.com']);
	});

	it('AC2-4: Subject / Body は UTF-8 charset で送信される (日本語 deliverability)', async () => {
		await sendEmail({
			to: 'recipient@example.com',
			subject: '日本語の件名 — 文字化け検証',
			htmlBody: '<p>日本語本文</p>',
		});

		const cmd = mockSend.mock.calls[0]?.[0];
		expect(cmd.params.Message.Subject.Charset).toBe('UTF-8');
		expect(cmd.params.Message.Body.Html.Charset).toBe('UTF-8');
	});
});

describe('#2192 AC3 バウンス処理 / エラーハンドリング', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSend.mockReset();
		process.env.AUTH_MODE = 'cognito';
	});

	afterEach(() => {
		delete process.env.AUTH_MODE;
	});

	it('AC3-1: SES が MessageRejected を throw すると sendEmail は false を返す', async () => {
		const error = new Error('MessageRejected: Email address is not verified');
		mockSend.mockRejectedValueOnce(error);

		const result = await sendEmail({
			to: 'unverified@example.com',
			subject: 'バウンス検証',
			htmlBody: '<p>本文</p>',
		});

		expect(result).toBe(false);
	});

	it('AC3-2: SES エラー時 logger.error で記録される (運用観察可能性)', async () => {
		mockSend.mockRejectedValueOnce(new Error('SES throttling'));

		await sendEmail({
			to: 'test@example.com',
			subject: 'エラー検証',
			htmlBody: '<p>本文</p>',
		});

		expect(mockLoggerError).toHaveBeenCalled();
		const errorCall = mockLoggerError.mock.calls[0];
		expect(errorCall?.[0]).toContain('メール送信失敗');
	});

	it('AC3-3: 一度失敗しても次回呼び出しは独立して評価される (副作用なし)', async () => {
		mockSend.mockRejectedValueOnce(new Error('temporary failure'));
		const firstResult = await sendEmail({
			to: 'a@example.com',
			subject: 'try1',
			htmlBody: '<p>1</p>',
		});

		mockSend.mockResolvedValueOnce({});
		const secondResult = await sendEmail({
			to: 'b@example.com',
			subject: 'try2',
			htmlBody: '<p>2</p>',
		});

		expect(firstResult).toBe(false);
		expect(secondResult).toBe(true);
	});

	it('AC3-4: ローカルモードでは SES エラー経路を回避 (silent success)', async () => {
		process.env.AUTH_MODE = 'local';
		mockSend.mockRejectedValueOnce(new Error('would not even be called'));

		const result = await sendEmail({
			to: 'test@example.com',
			subject: 'local モード',
			htmlBody: '<p>本文</p>',
		});

		expect(result).toBe(true); // local モードは常に true (実 SES 呼ばない)
		expect(mockSend).not.toHaveBeenCalled();
	});
});

describe('#2192 AC1 4 系統 unit smoke — 各テンプレート関数', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSend.mockReset();
		mockSend.mockResolvedValue({});
		process.env.AUTH_MODE = 'cognito';
	});

	afterEach(() => {
		delete process.env.AUTH_MODE;
	});

	it('系統 1 (weekly-report 基盤): sendEmail が標準テンプレート構造で SES に投げる', async () => {
		const result = await sendEmail({
			to: 'po@example.com',
			subject: '🌟 たろうの今週のがんばり',
			htmlBody: '<table>...</table>',
		});
		expect(result).toBe(true);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('系統 2 (lifecycle 基盤): listUnsubscribeUrl 付きで RawEmail に切替', async () => {
		const result = await sendEmail({
			to: 'parent@example.com',
			subject: '【がんばりクエスト】期限切れ前のご案内',
			htmlBody: '<p>本文</p>',
			textBody: 'text 本文',
			listUnsubscribeUrl: 'https://ganbari-quest.com/unsubscribe/test-token',
		});
		expect(result).toBe(true);
		expect(mockSend).toHaveBeenCalledTimes(1);
		const cmd = mockSend.mock.calls[0]?.[0];
		// SendRawEmailCommand が RawMessage プロパティを持つ
		expect(cmd.params).toHaveProperty('RawMessage');
	});

	it('系統 3 (welcome / 系統共通): sendWelcomeEmail が動作する', async () => {
		const result = await sendWelcomeEmail('newuser@example.com', '田中');
		expect(result).toBe(true);
	});

	it('系統 4 (system 通知): 件名・本文に絵文字を含んでも UTF-8 で送信される', async () => {
		const result = await sendEmail({
			to: 'parent@example.com',
			subject: '🎉 新しいメンバーが参加しました',
			htmlBody: '<p>絵文字 ✨ を含む本文</p>',
		});
		expect(result).toBe(true);
		const cmd = mockSend.mock.calls[0]?.[0];
		expect(cmd.params.Message.Subject.Charset).toBe('UTF-8');
	});
});
