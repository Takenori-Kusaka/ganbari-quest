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
	sanitizeDiscordText,
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

		it('#3388: 全 payload に allowed_mentions:{parse:[]} を含み ping を構造的に無効化する', async () => {
			await notifyDiscord('inquiry', { title: 'mention テスト', color: 0 });
			const body = getLastBody();
			expect(body.allowed_mentions).toEqual({ parse: [] });
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

		// #3211: ユーザー自由記述の mention 構文中和 (PII 自由記述の webhook 素通り抑止 + 誤 ping 防止)
		it('本文の @everyone / @here / role mention を中和して embed に載せる', async () => {
			await notifyInquiry(
				'tenant-1',
				'other',
				'緊急 @everyone @here <@&999> 見てください',
				'user@test.com',
			);
			const body = getLastBody();
			const desc = body.embeds[0].description as string;
			// 可視内容は保持しつつ mention 構文を壊す (素の @everyone / role mention は残らない)
			expect(desc).not.toMatch(/@everyone/);
			expect(desc).not.toMatch(/@here/);
			expect(desc).not.toMatch(/<@&999>/);
			expect(desc).toContain('everyone'); // zero-width space 挿入で文字自体は保持
			expect(desc).toContain('見てください');
		});

		it('#3388: email/返信先は zero-width space 中和せず原文のまま (foo@here.com 破損回帰の防止)', async () => {
			await notifyInquiry('tenant-1', 'other', '本文', 'parent@here.com', 'reply@everyone.org');
			const body = getLastBody();
			const fields = body.embeds[0].fields as Array<{ name: string; value: string }>;
			const sender = fields.find((f) => f.name === '送信者')?.value;
			const reply = fields.find((f) => f.name === '返信先')?.value;
			// zero-width space が混入せず原文一致 (コピペ返信が壊れない)。ping は allowed_mentions で無効化済。
			expect(sender).toBe('parent@here.com');
			expect(reply).toBe('reply@everyone.org');
		});
	});

	describe('sanitizeDiscordText (#3211)', () => {
		it('@everyone / @here を中和する (文字は保持、mention は壊す)', () => {
			const out = sanitizeDiscordText('@everyone and @here');
			expect(out).not.toMatch(/@everyone/);
			expect(out).not.toMatch(/@here/);
			expect(out).toContain('everyone');
			expect(out).toContain('here');
		});

		it('user / role / channel mention (<@123> / <@&123> / <#123>) を中和する', () => {
			const out = sanitizeDiscordText('<@123> <@!456> <@&789> <#321>');
			expect(out).not.toMatch(/<@123>/);
			expect(out).not.toMatch(/<@!456>/);
			expect(out).not.toMatch(/<@&789>/);
			expect(out).not.toMatch(/<#321>/);
		});

		it('mention を含まない通常文はそのまま (誤変換しない)', () => {
			expect(sanitizeDiscordText('普通の問い合わせ user@example.com')).toBe(
				'普通の問い合わせ user@example.com',
			);
		});
	});
});
