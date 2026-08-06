import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock $env/dynamic/private
vi.mock('$env/dynamic/private', () => ({
	env: {
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
	notifyDiscord,
	notifyIncident,
	notifyInquiry,
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
			await notifyDiscord('incident', {
				title: 'テスト',
				color: 0x000000,
			});

			expect(fetchSpy).toHaveBeenCalledOnce();
			expect(fetchSpy).toHaveBeenCalledWith(
				'https://discord.com/api/webhooks/test-incident',
				expect.objectContaining({
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
				}),
			);
		});

		it('送信ペイロードに embeds を含む', async () => {
			await notifyDiscord('incident', {
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

			await expect(
				notifyDiscord('incident', { title: 'テスト', color: 0 }),
			).resolves.toBeUndefined();
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
		// #4197: payload には受付番号 / カテゴリ / 本文だけを載せる (tenantId / email は載せない)。
		// 「誰から」は受付番号を鍵に inquiries 表 (認証された場所) で引く。
		it('受付番号とカテゴリを載せ、tenantId / メールアドレスは載せない', async () => {
			await notifyInquiry('bug', 'ログインできません', 'INQ-20260805-001');

			const body = getLastBody();
			expect(body.embeds[0].title).toBe('📬 バグ報告 (INQ-20260805-001)');
			expect(body.embeds[0].description).toBe('ログインできません');
			const fields = body.embeds[0].fields as Array<{ name: string; value: string }>;
			expect(fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: '受付番号', value: 'INQ-20260805-001' }),
					expect.objectContaining({ name: 'カテゴリ', value: 'バグ報告' }),
				]),
			);
			// 認証された場所で引く導線が載る (受付番号が照会の鍵)
			const lookup = fields.find((f) => f.name === '送信者を見る')?.value ?? '';
			expect(lookup).toContain('inquiries');
			expect(lookup).toContain('INQ-20260805-001');
			// 撤去された field は復活していない
			expect(fields.map((f) => f.name)).not.toContain('テナント');
			expect(fields.map((f) => f.name)).not.toContain('送信者');
			expect(fields.map((f) => f.name)).not.toContain('返信先');
		});

		// #3211: ユーザー自由記述の mention 構文中和 (誤 ping 防止)
		it('本文の @everyone / @here / role mention を中和して embed に載せる', async () => {
			await notifyInquiry('other', '緊急 @everyone @here <@&999> 見てください');
			const body = getLastBody();
			const desc = body.embeds[0].description as string;
			// 可視内容は保持しつつ mention 構文を壊す (素の @everyone / role mention は残らない)
			expect(desc).not.toMatch(/@everyone/);
			expect(desc).not.toMatch(/@here/);
			expect(desc).not.toMatch(/<@&999>/);
			expect(desc).toContain('everyone'); // zero-width space 挿入で文字自体は保持
			expect(desc).toContain('見てください');
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
