import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock $env/dynamic/private
vi.mock('$env/dynamic/private', () => ({
	env: {
		DISCORD_WEBHOOK_SIGNUP: 'https://discord.com/api/webhooks/test-signup',
		DISCORD_WEBHOOK_BILLING: 'https://discord.com/api/webhooks/test-billing',
		DISCORD_WEBHOOK_CHURN: 'https://discord.com/api/webhooks/test-churn',
		DISCORD_WEBHOOK_INCIDENT: 'https://discord.com/api/webhooks/test-incident',
		DISCORD_WEBHOOK_INQUIRY: '',
		FEEDBACK_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/test-feedback',
	},
}));

// Mock logger
vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import {
	notifyBillingEvent,
	notifyCancellation,
	notifyCancellationReverted,
	notifyDeletionComplete,
	notifyDiscord,
	notifyIncident,
	notifyInquiry,
	notifyNewSignup,
} from '$lib/server/services/discord-notify-service';

describe('discord-notify-service', () => {
	const fetchSpy = vi.fn().mockResolvedValue({ ok: true });

	// biome-ignore lint/suspicious/noExplicitAny: test helper parsing JSON needs flexible type
	function getLastBody(): any {
		const call = fetchSpy.mock.calls[0] as [string, { body: string }] | undefined;
		if (!call) throw new Error('fetch was not called');
		return JSON.parse(call[1].body);
	}

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchSpy);
		fetchSpy.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('notifyDiscord', () => {
		it('Webhook URL が設定されている場合に fetch を呼び出す', async () => {
			await notifyDiscord('signup', {
				title: 'テスト',
				color: 0x000000,
			});

			expect(fetchSpy).toHaveBeenCalledOnce();
			expect(fetchSpy).toHaveBeenCalledWith(
				'https://discord.com/api/webhooks/test-signup',
				expect.objectContaining({
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
				}),
			);
		});

		it('送信ペイロードに embeds を含む', async () => {
			await notifyDiscord('billing', {
				title: '課金テスト',
				color: 0x3498db,
				fields: [{ name: 'テスト', value: '値' }],
			});

			const body = getLastBody();
			expect(body.embeds).toHaveLength(1);
			expect(body.embeds[0].title).toBe('課金テスト');
			expect(body.embeds[0].timestamp).toBeDefined();
		});

		it('inquiry チャネルは FEEDBACK_DISCORD_WEBHOOK_URL にフォールバックする', async () => {
			await notifyDiscord('inquiry', {
				title: '問い合わせテスト',
				color: 0x4a90d9,
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				'https://discord.com/api/webhooks/test-feedback',
				expect.any(Object),
			);
		});

		it('fetch 失敗時にエラーを投げない', async () => {
			fetchSpy.mockRejectedValueOnce(new Error('Network error'));

			await expect(notifyDiscord('signup', { title: 'テスト', color: 0 })).resolves.toBeUndefined();
		});
	});

	describe('notifyNewSignup', () => {
		it('新規登録通知を送信する', async () => {
			await notifyNewSignup('tenant-123', 'user@example.com');

			const body = getLastBody();
			expect(body.embeds[0].title).toBe('🆕 新規登録');
			expect(body.embeds[0].fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: 'テナントID', value: 'tenant-123' }),
					expect.objectContaining({ name: 'メール', value: 'user@example.com' }),
				]),
			);
		});
	});

	describe('notifyBillingEvent', () => {
		it('課金開始通知を送信する', async () => {
			await notifyBillingEvent('tenant-123', 'checkout_completed', 'plan=monthly');

			const body = getLastBody();
			expect(body.embeds[0].title).toBe('💳 課金開始');
			expect(body.embeds[0].color).toBe(0x3498db);
		});

		it('支払い失敗通知を送信する', async () => {
			await notifyBillingEvent('tenant-123', 'payment_failed');

			const body = getLastBody();
			expect(body.embeds[0].title).toBe('❌ 支払い失敗');
			expect(body.embeds[0].color).toBe(0xe74c3c);
		});
	});

	describe('notifyCancellation', () => {
		it('退会申請通知を送信する', async () => {
			await notifyCancellation('tenant-123', '2026-04-28');

			const body = getLastBody();
			expect(body.embeds[0].title).toBe('⚠️ 退会申請');
			expect(body.embeds[0].fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: '猶予期間終了', value: '2026-04-28' }),
				]),
			);
		});
	});

	describe('notifyCancellationReverted', () => {
		it('退会キャンセル通知を送信する', async () => {
			await notifyCancellationReverted('tenant-123');

			const body = getLastBody();
			expect(body.embeds[0].title).toBe('↩️ 退会キャンセル');
		});
	});

	describe('notifyDeletionComplete', () => {
		it('データ削除完了通知を送信する', async () => {
			await notifyDeletionComplete('tenant-123', { items: 150, files: 12 });

			const body = getLastBody();
			expect(body.embeds[0].title).toBe('🗑️ データ削除完了');
			expect(body.embeds[0].fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: '削除アイテム数', value: '150' }),
					expect.objectContaining({ name: '削除ファイル数', value: '12' }),
				]),
			);
		});
	});

	describe('notifyIncident', () => {
		it('障害通知を送信する', async () => {
			await notifyIncident('TypeError: Cannot read properties', {
				method: 'GET',
				path: '/api/v1/children',
				status: 500,
			});

			const body = getLastBody();
			expect(body.embeds[0].title).toBe('🚨 システムエラー');
			expect(body.embeds[0].description).toContain('TypeError');
			expect(body.embeds[0].color).toBe(0xe74c3c);
		});
	});

	describe('notifyInquiry', () => {
		it('問い合わせ通知を送信する', async () => {
			await notifyInquiry(
				'tenant-123',
				'bug',
				'ログインできません',
				'user@test.com',
				'reply@test.com',
			);

			const body = getLastBody();
			expect(body.embeds[0].title).toBe('📬 バグ報告');
			expect(body.embeds[0].description).toBe('ログインできません');
			expect(body.embeds[0].fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: '返信先', value: 'reply@test.com' }),
				]),
			);
		});
	});
});
