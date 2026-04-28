// tests/unit/services/lifecycle-email-service.test.ts
// #1601 (ADR-0023 §3.2 §3.3 §5 I11): ライフサイクルメール処理のユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ============================================================
// Mocks
// ============================================================

const mockListAllTenants = vi.fn();
const mockFindTenantMembers = vi.fn();
const mockFindUserById = vi.fn();
const settingsStore = new Map<string, string>();
const mockGetSetting = vi.fn(async (key: string, tenantId: string) =>
	settingsStore.get(`${tenantId}:${key}`),
);
const mockSetSetting = vi.fn(async (key: string, value: string, tenantId: string) => {
	settingsStore.set(`${tenantId}:${key}`, value);
});

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			listAllTenants: mockListAllTenants,
			findTenantMembers: mockFindTenantMembers,
			findUserById: mockFindUserById,
		},
		settings: {
			getSetting: mockGetSetting,
			setSetting: mockSetSetting,
			getSettings: vi.fn(),
		},
	}),
}));

const mockSendRenewal = vi.fn(async (_params: unknown) => true);
const mockSendDormant = vi.fn(async (_params: unknown) => true);

vi.mock('../../../src/lib/server/services/email-service', () => ({
	sendLicenseRenewalReminderEmail: (params: unknown) => mockSendRenewal(params),
	sendDormantReactivationEmail: (params: unknown) => mockSendDormant(params),
}));

import {
	DORMANT_THRESHOLD_DAYS,
	daysSinceLastActive,
	daysUntil,
	isRenewalReminderDay,
	isTenantUnsubscribed,
	markTenantUnsubscribed,
	RENEWAL_REMINDER_DAYS,
	runLifecycleEmails,
} from '../../../src/lib/server/services/lifecycle-email-service';

// ============================================================
// Helpers
// ============================================================

const NOW = new Date('2026-04-27T01:00:00Z');

function makeTenant(
	overrides: Partial<{
		tenantId: string;
		plan: string | undefined;
		planExpiresAt: string | undefined;
		lastActiveAt: string | undefined;
		createdAt: string;
	}> = {},
) {
	return {
		tenantId: overrides.tenantId ?? 't-1',
		name: 'テスト家族',
		ownerId: 'u-1',
		status: 'active',
		plan: overrides.plan,
		planExpiresAt: overrides.planExpiresAt,
		lastActiveAt: overrides.lastActiveAt,
		createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
		updatedAt: '2026-04-01T00:00:00Z',
	};
}

function setupSingleTenantWithOwner(tenant = makeTenant()) {
	mockListAllTenants.mockResolvedValueOnce([tenant]);
	mockFindTenantMembers.mockResolvedValueOnce([
		{ userId: 'u-1', tenantId: tenant.tenantId, role: 'owner', joinedAt: '2026-01-01' },
	]);
	mockFindUserById.mockResolvedValueOnce({
		userId: 'u-1',
		email: 'owner@example.com',
		provider: 'cognito',
		displayName: 'テスト オーナー',
		createdAt: '2026-01-01',
		updatedAt: '2026-01-01',
	});
}

beforeEach(() => {
	settingsStore.clear();
	mockListAllTenants.mockReset();
	mockFindTenantMembers.mockReset();
	mockFindUserById.mockReset();
	mockGetSetting.mockClear();
	mockSetSetting.mockClear();
	mockSendRenewal.mockClear();
	mockSendDormant.mockClear();
	mockSendRenewal.mockResolvedValue(true);
	mockSendDormant.mockResolvedValue(true);
});

afterEach(() => {
	vi.clearAllMocks();
});

// ============================================================
// Pure helper functions
// ============================================================

describe('#1601 lifecycle-email-service — daysUntil', () => {
	it('未来の日付なら正の整数', () => {
		expect(daysUntil('2026-05-04T01:00:00Z', NOW)).toBe(7);
	});

	it('過去の日付なら 0 以下', () => {
		expect(daysUntil('2026-04-20T01:00:00Z', NOW)).toBeLessThanOrEqual(0);
	});

	it('当日 = 0', () => {
		expect(daysUntil('2026-04-27T01:00:00Z', NOW)).toBe(0);
	});
});

describe('#1601 lifecycle-email-service — isRenewalReminderDay', () => {
	it('30 / 7 / 1 のいずれかでのみ true', () => {
		expect(isRenewalReminderDay(30)).toBe(true);
		expect(isRenewalReminderDay(7)).toBe(true);
		expect(isRenewalReminderDay(1)).toBe(true);
	});

	it('それ以外は false', () => {
		expect(isRenewalReminderDay(0)).toBe(false);
		expect(isRenewalReminderDay(2)).toBe(false);
		expect(isRenewalReminderDay(14)).toBe(false);
		expect(isRenewalReminderDay(31)).toBe(false);
	});

	it('RENEWAL_REMINDER_DAYS は 30 / 7 / 1 を含む', () => {
		expect(RENEWAL_REMINDER_DAYS).toEqual([30, 7, 1]);
	});
});

describe('#1601 lifecycle-email-service — daysSinceLastActive', () => {
	it('lastActiveAt から経過日数を返す', () => {
		expect(daysSinceLastActive('2026-04-20T01:00:00Z', '2026-01-01T00:00:00Z', NOW)).toBe(7);
	});

	it('lastActiveAt 未設定なら createdAt にフォールバック', () => {
		const result = daysSinceLastActive(undefined, '2026-01-01T00:00:00Z', NOW);
		expect(result).toBeGreaterThan(100);
	});

	it('DORMANT_THRESHOLD_DAYS は 90 (ADR-0023 §5 I11)', () => {
		expect(DORMANT_THRESHOLD_DAYS).toBe(90);
	});
});

// ============================================================
// runLifecycleEmails — 期限切れ前リマインド
// ============================================================

describe('#1601 lifecycle-email-service — 期限切れ前リマインド', () => {
	it('残り 7 日のテナントに renewal メールを送る', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: '2026-05-04T01:00:00Z', // 7 日後
			}),
		);

		const result = await runLifecycleEmails({ now: NOW });

		expect(result.renewalSent).toBe(1);
		expect(mockSendRenewal).toHaveBeenCalledTimes(1);
		expect(mockSendRenewal).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'owner@example.com',
				tenantId: 't-1',
				ownerName: 'テスト オーナー',
				daysRemaining: 7,
			}),
		);
		// 年 6 回カウンタが増えている
		expect(settingsStore.get('t-1:marketing_email_count_2026')).toBe('1');
	});

	it('残り 30 日でも送る', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'family_monthly',
				planExpiresAt: '2026-05-27T01:00:00Z', // 30 日後
			}),
		);

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.renewalSent).toBe(1);
	});

	it('残り 14 日 (対象外) は送らない', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: '2026-05-11T01:00:00Z', // 14 日後
			}),
		);

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.renewalSent).toBe(0);
		expect(mockSendRenewal).not.toHaveBeenCalled();
	});

	it('plan 未設定 (free / trial) には送らない', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: undefined,
				planExpiresAt: '2026-05-04T01:00:00Z',
			}),
		);

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.renewalSent).toBe(0);
	});

	it('planExpiresAt 未設定なら renewal 候補にしない', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: undefined,
			}),
		);
		const result = await runLifecycleEmails({ now: NOW });
		expect(result.renewalSent).toBe(0);
	});
});

// ============================================================
// runLifecycleEmails — 休眠復帰メール
// ============================================================

describe('#1601 lifecycle-email-service — 休眠復帰メール', () => {
	it('lastActiveAt が 90 日以上前なら dormant メールを送る', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				lastActiveAt: '2026-01-01T00:00:00Z', // ~117 日前
			}),
		);

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.dormantSent).toBe(1);
		expect(mockSendDormant).toHaveBeenCalledTimes(1);
		expect(mockSendDormant).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'owner@example.com',
				tenantId: 't-1',
				daysSinceLastActive: expect.any(Number),
			}),
		);
		// dormant_reactivation_sent フラグが設定された
		expect(settingsStore.get('t-1:dormant_reactivation_sent')).toBeDefined();
	});

	it('既に dormant メール送信済みなら再送しない (1 回限り)', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				lastActiveAt: '2026-01-01T00:00:00Z',
			}),
		);
		settingsStore.set('t-1:dormant_reactivation_sent', '2026-04-20T00:00:00Z');

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.dormantSent).toBe(0);
		expect(result.skippedAlreadySent).toBe(1);
		expect(mockSendDormant).not.toHaveBeenCalled();
	});

	it('lastActiveAt 未設定なら createdAt 経過日でフォールバック判定', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				lastActiveAt: undefined,
				createdAt: '2026-01-01T00:00:00Z', // 117 日前
			}),
		);
		const result = await runLifecycleEmails({ now: NOW });
		expect(result.dormantSent).toBe(1);
	});

	it('lastActiveAt が 30 日以内 (休眠未満) なら送らない', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				lastActiveAt: '2026-04-20T00:00:00Z', // 7 日前
			}),
		);
		const result = await runLifecycleEmails({ now: NOW });
		expect(result.dormantSent).toBe(0);
	});
});

// ============================================================
// 年 6 回上限 (ADR-0023 §3.3)
// ============================================================

describe('#1601 lifecycle-email-service — 年 6 回上限', () => {
	it('上限到達済みのテナントには送らない (renewal)', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: '2026-05-04T01:00:00Z',
			}),
		);
		settingsStore.set('t-1:marketing_email_count_2026', '6');

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.renewalSent).toBe(0);
		expect(result.skippedRateLimit).toBe(1);
		expect(mockSendRenewal).not.toHaveBeenCalled();
	});

	it('上限到達済みのテナントには送らない (dormant)', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				lastActiveAt: '2026-01-01T00:00:00Z',
			}),
		);
		settingsStore.set('t-1:marketing_email_count_2026', '6');

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.dormantSent).toBe(0);
		expect(result.skippedRateLimit).toBe(1);
	});
});

// ============================================================
// opt-out (配信停止)
// ============================================================

describe('#1601 lifecycle-email-service — opt-out', () => {
	it('marketing_unsubscribed_at が設定済みなら送らない', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: '2026-05-04T01:00:00Z',
			}),
		);
		settingsStore.set('t-1:marketing_unsubscribed_at', '2026-04-20T00:00:00Z');

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.skippedUnsubscribed).toBe(1);
		expect(result.renewalSent).toBe(0);
	});

	it('markTenantUnsubscribed → isTenantUnsubscribed で取得できる', async () => {
		expect(await isTenantUnsubscribed('t-1')).toBe(false);
		await markTenantUnsubscribed('t-1', NOW);
		expect(await isTenantUnsubscribed('t-1')).toBe(true);
	});
});

// ============================================================
// オーナー欠落 / 子供アカウント送信禁止
// ============================================================

describe('#1601 lifecycle-email-service — オーナー解決', () => {
	it('owner ロールメンバーがいないテナントはスキップ', async () => {
		mockListAllTenants.mockResolvedValueOnce([
			makeTenant({ plan: 'standard_monthly', planExpiresAt: '2026-05-04T01:00:00Z' }),
		]);
		mockFindTenantMembers.mockResolvedValueOnce([
			{ userId: 'u-2', tenantId: 't-1', role: 'child', joinedAt: '2026-01-01' },
		]);

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.skippedNoOwner).toBe(1);
		expect(mockSendRenewal).not.toHaveBeenCalled();
	});

	it('owner の email が無いテナントはスキップ (子供アカウントへの送信を防ぐ)', async () => {
		mockListAllTenants.mockResolvedValueOnce([
			makeTenant({ plan: 'standard_monthly', planExpiresAt: '2026-05-04T01:00:00Z' }),
		]);
		mockFindTenantMembers.mockResolvedValueOnce([
			{ userId: 'u-1', tenantId: 't-1', role: 'owner', joinedAt: '2026-01-01' },
		]);
		mockFindUserById.mockResolvedValueOnce({
			userId: 'u-1',
			email: '',
			provider: 'cognito',
			createdAt: '2026-01-01',
			updatedAt: '2026-01-01',
		});

		const result = await runLifecycleEmails({ now: NOW });
		expect(result.skippedNoOwner).toBe(1);
	});
});

// ============================================================
// dryRun
// ============================================================

describe('#1601 lifecycle-email-service — dryRun', () => {
	it('dryRun=true ならメール送信せずカウンタも増やさない', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: '2026-05-04T01:00:00Z',
			}),
		);

		const result = await runLifecycleEmails({ now: NOW, dryRun: true });
		expect(result.dryRun).toBe(true);
		expect(result.renewalSent).toBe(1); // 集計上は対象としてカウントされる
		expect(mockSendRenewal).not.toHaveBeenCalled();
		expect(settingsStore.get('t-1:marketing_email_count_2026')).toBeUndefined();
	});
});
