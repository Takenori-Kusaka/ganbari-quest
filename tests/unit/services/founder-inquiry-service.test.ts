import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock $env/dynamic/private (discord-notify-service が参照)
vi.mock('$env/dynamic/private', () => ({
	env: {
		DISCORD_WEBHOOK_INQUIRY: 'https://discord.com/api/webhooks/test-inquiry',
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import {
	FOUNDER_INQUIRY_LIMITS,
	notifyFounderInquiry,
	validateFounderInquiry,
} from '$lib/server/services/founder-inquiry-service';

describe('founder-inquiry-service', () => {
	describe('validateFounderInquiry', () => {
		it('全フィールドが有効な場合、ok: true を返す', () => {
			const result = validateFounderInquiry({
				name: '山田 太郎',
				email: 'parent@example.com',
				childAge: '7 歳',
				message: '導入前に相談させてください',
				sourcePath: '/admin/settings',
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.name).toBe('山田 太郎');
				expect(result.value.email).toBe('parent@example.com');
				expect(result.value.childAge).toBe('7 歳');
				expect(result.value.message).toBe('導入前に相談させてください');
				expect(result.value.sourcePath).toBe('/admin/settings');
			}
		});

		it('childAge と sourcePath は省略可', () => {
			const result = validateFounderInquiry({
				name: 'A',
				email: 'a@example.com',
				message: '相談内容',
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.childAge).toBeUndefined();
				expect(result.value.sourcePath).toBeUndefined();
			}
		});

		it('name 未入力はエラー', () => {
			const result = validateFounderInquiry({
				name: '',
				email: 'a@example.com',
				message: '相談内容',
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors.some((e) => e.field === 'name')).toBe(true);
			}
		});

		it('email 未入力はエラー', () => {
			const result = validateFounderInquiry({
				name: '山田',
				email: '',
				message: '相談内容',
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors.some((e) => e.field === 'email')).toBe(true);
			}
		});

		it('email 形式不正はエラー', () => {
			const result = validateFounderInquiry({
				name: '山田',
				email: 'not-an-email',
				message: '相談内容',
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors.some((e) => e.field === 'email')).toBe(true);
			}
		});

		it('message 未入力はエラー', () => {
			const result = validateFounderInquiry({
				name: '山田',
				email: 'a@example.com',
				message: '',
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors.some((e) => e.field === 'message')).toBe(true);
			}
		});

		it('message が上限を超えるとエラー', () => {
			const result = validateFounderInquiry({
				name: '山田',
				email: 'a@example.com',
				message: 'a'.repeat(FOUNDER_INQUIRY_LIMITS.MESSAGE_MAX + 1),
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors.some((e) => e.field === 'message')).toBe(true);
			}
		});

		it('name が上限を超えるとエラー', () => {
			const result = validateFounderInquiry({
				name: 'a'.repeat(FOUNDER_INQUIRY_LIMITS.NAME_MAX + 1),
				email: 'a@example.com',
				message: '相談内容',
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors.some((e) => e.field === 'name')).toBe(true);
			}
		});

		it('null / undefined / 不正な型でも safe にエラー化', () => {
			const r1 = validateFounderInquiry(null);
			expect(r1.ok).toBe(false);
			const r2 = validateFounderInquiry(undefined);
			expect(r2.ok).toBe(false);
			const r3 = validateFounderInquiry({ name: 123, email: {}, message: [] });
			expect(r3.ok).toBe(false);
		});

		it('複数フィールドのエラーをすべて返す', () => {
			const result = validateFounderInquiry({
				name: '',
				email: 'invalid',
				message: '',
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				const fields = result.errors.map((e) => e.field);
				expect(fields).toContain('name');
				expect(fields).toContain('email');
				expect(fields).toContain('message');
			}
		});
	});

	describe('notifyFounderInquiry', () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true });

		beforeEach(() => {
			vi.stubGlobal('fetch', fetchSpy);
			fetchSpy.mockClear();
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		// biome-ignore lint/suspicious/noExplicitAny: parsing JSON for test assertion
		function getLastBody(): any {
			const call = fetchSpy.mock.calls[0] as [string, { body: string }] | undefined;
			if (!call) throw new Error('fetch was not called');
			return JSON.parse(call[1].body);
		}

		it('Discord webhook (inquiry チャネル) に POST する', async () => {
			await notifyFounderInquiry({
				name: '山田',
				email: 'parent@example.com',
				message: '相談内容',
			});

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const [url] = fetchSpy.mock.calls[0] as [string, unknown];
			expect(url).toBe('https://discord.com/api/webhooks/test-inquiry');
		});

		it('embed.title に founder 直接相談 と書く', async () => {
			await notifyFounderInquiry({
				name: '山田',
				email: 'parent@example.com',
				message: '相談内容',
			});
			const body = getLastBody();
			const embed = body.embeds[0];
			expect(embed.title).toContain('founder');
			expect(embed.description).toBe('相談内容');
		});

		it('childAge / tenantId / sourcePath が embed fields に含まれる', async () => {
			await notifyFounderInquiry({
				name: '山田',
				email: 'parent@example.com',
				childAge: '7 歳',
				tenantId: 'tenant-abc',
				sourcePath: '/admin/settings',
				message: '相談内容',
			});
			const body = getLastBody();
			const fields = body.embeds[0].fields;
			const fieldNames = fields.map((f: { name: string }) => f.name);
			expect(fieldNames).toContain('お名前');
			expect(fieldNames).toContain('返信先メール');
			expect(fieldNames).toContain('お子さま年齢');
			expect(fieldNames).toContain('テナント ID');
			expect(fieldNames).toContain('送信元');
		});

		it('childAge / tenantId / sourcePath が無い場合は対応 field を含めない', async () => {
			await notifyFounderInquiry({
				name: '山田',
				email: 'parent@example.com',
				message: '相談内容',
			});
			const body = getLastBody();
			const fields = body.embeds[0].fields;
			const fieldNames = fields.map((f: { name: string }) => f.name);
			expect(fieldNames).not.toContain('お子さま年齢');
			expect(fieldNames).not.toContain('テナント ID');
			expect(fieldNames).not.toContain('送信元');
		});

		it('長文 message は Discord 上限手前で truncate される', async () => {
			const longMessage = 'a'.repeat(FOUNDER_INQUIRY_LIMITS.MESSAGE_DISCORD_TRUNCATE + 200);
			await notifyFounderInquiry({
				name: '山田',
				email: 'parent@example.com',
				message: longMessage,
			});
			const body = getLastBody();
			const description = body.embeds[0].description as string;
			expect(description.length).toBeLessThanOrEqual(
				FOUNDER_INQUIRY_LIMITS.MESSAGE_DISCORD_TRUNCATE + 10,
			);
			expect(description.endsWith('…(以下省略)')).toBe(true);
		});
	});
});
