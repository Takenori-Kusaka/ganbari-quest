// tests/unit/services/marketing-email-counter.test.ts
// #1601: マーケティングメール接触頻度カウンタのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// settings KV をメモリで模擬
const settingsStore = new Map<string, string>();
const mockGetSetting = vi.fn(async (key: string, tenantId: string) => {
	return settingsStore.get(`${tenantId}:${key}`);
});
const mockSetSetting = vi.fn(async (key: string, value: string, tenantId: string) => {
	settingsStore.set(`${tenantId}:${key}`, value);
});

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		settings: {
			getSetting: mockGetSetting,
			setSetting: mockSetSetting,
			getSettings: vi.fn(),
		},
	}),
}));

import {
	canSendMarketingEmail,
	getCurrentYearKey,
	getMarketingEmailCount,
	incrementMarketingEmailCount,
	MARKETING_EMAIL_YEARLY_LIMIT,
} from '../../../src/lib/server/services/marketing-email-counter';

beforeEach(() => {
	settingsStore.clear();
	mockGetSetting.mockClear();
	mockSetSetting.mockClear();
});

describe('#1601 marketing-email-counter — getCurrentYearKey', () => {
	it('UTC 4 桁の年を返す', () => {
		const fixedDate = new Date('2026-04-27T12:00:00Z');
		expect(getCurrentYearKey(fixedDate)).toBe('2026');
	});

	it('年跨ぎ (12/31 23:59 UTC → 1/1 00:00 UTC) で年が切り替わる', () => {
		expect(getCurrentYearKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026');
		expect(getCurrentYearKey(new Date('2027-01-01T00:00:00Z'))).toBe('2027');
	});
});

describe('#1601 marketing-email-counter — getMarketingEmailCount', () => {
	it('未送信なら 0 を返す', async () => {
		expect(await getMarketingEmailCount('t-1', '2026')).toBe(0);
	});

	it('保存済みの値をパースして返す', async () => {
		settingsStore.set('t-1:marketing_email_count_2026', '3');
		expect(await getMarketingEmailCount('t-1', '2026')).toBe(3);
	});

	it('数値以外が保存されていたら 0 を返し warn ログを出す', async () => {
		settingsStore.set('t-1:marketing_email_count_2026', 'corrupted');
		expect(await getMarketingEmailCount('t-1', '2026')).toBe(0);
	});

	it('負値は 0 として扱う (sanity)', async () => {
		settingsStore.set('t-1:marketing_email_count_2026', '-5');
		expect(await getMarketingEmailCount('t-1', '2026')).toBe(0);
	});
});

describe('#1601 marketing-email-counter — incrementMarketingEmailCount', () => {
	it('初回 increment で 1 を返す', async () => {
		const next = await incrementMarketingEmailCount('t-1', '2026');
		expect(next).toBe(1);
		expect(settingsStore.get('t-1:marketing_email_count_2026')).toBe('1');
	});

	it('既存値を 1 増やす', async () => {
		settingsStore.set('t-1:marketing_email_count_2026', '4');
		const next = await incrementMarketingEmailCount('t-1', '2026');
		expect(next).toBe(5);
	});

	it('テナントごとに独立してカウントする', async () => {
		await incrementMarketingEmailCount('t-1', '2026');
		await incrementMarketingEmailCount('t-2', '2026');
		expect(await getMarketingEmailCount('t-1', '2026')).toBe(1);
		expect(await getMarketingEmailCount('t-2', '2026')).toBe(1);
	});

	it('年ごとに独立してカウントする (年跨ぎリセット)', async () => {
		await incrementMarketingEmailCount('t-1', '2026');
		await incrementMarketingEmailCount('t-1', '2026');
		expect(await getMarketingEmailCount('t-1', '2026')).toBe(2);
		expect(await getMarketingEmailCount('t-1', '2027')).toBe(0);
	});
});

describe('#1601 marketing-email-counter — canSendMarketingEmail', () => {
	it('未送信なら true', async () => {
		expect(await canSendMarketingEmail('t-1', '2026')).toBe(true);
	});

	it('上限未満なら true', async () => {
		settingsStore.set('t-1:marketing_email_count_2026', String(MARKETING_EMAIL_YEARLY_LIMIT - 1));
		expect(await canSendMarketingEmail('t-1', '2026')).toBe(true);
	});

	it('上限到達なら false', async () => {
		settingsStore.set('t-1:marketing_email_count_2026', String(MARKETING_EMAIL_YEARLY_LIMIT));
		expect(await canSendMarketingEmail('t-1', '2026')).toBe(false);
	});

	it('上限超過 (race による誤差等) でも false', async () => {
		settingsStore.set('t-1:marketing_email_count_2026', String(MARKETING_EMAIL_YEARLY_LIMIT + 1));
		expect(await canSendMarketingEmail('t-1', '2026')).toBe(false);
	});
});

describe('#1601 marketing-email-counter — 上限はちょうど 6', () => {
	it('ADR-0023 §3.3 が定める年間上限は 6 件', () => {
		expect(MARKETING_EMAIL_YEARLY_LIMIT).toBe(6);
	});
});
