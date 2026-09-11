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

	// #4721: cron が milestone 当日に落ちるとリマインドが永久に失われるため、
	// milestone から 3 日以内なら遅れて送る (窓を出た顧客には送らない = 導入時の一斉送信を作らない)。
	it('#4721 catch-up: 残り 6 日 (7 日 milestone の 1 日遅れ) でも送る', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: '2026-05-03T01:00:00Z', // 6 日後
			}),
		);

		const result = await runLifecycleEmails({ now: NOW });

		expect(result.renewalSent).toBe(1);
		// **本文には実際の残日数を渡す** (milestone の 7 ではない。catch-up で嘘を書かない)
		expect(mockSendRenewal).toHaveBeenCalledWith(expect.objectContaining({ daysRemaining: 6 }));
	});

	// マーカーが「契約 × milestone」で立つので、catch-up しても 2 通目は出ない。
	it('#4721 送信済マーカーがあれば同じ milestone を再送しない', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: '2026-05-04T01:00:00Z', // 7 日後
			}),
		);

		const first = await runLifecycleEmails({ now: NOW });
		expect(first.renewalSent).toBe(1);
		expect(settingsStore.get('t-1:renewal_reminder_sent_marker')).toBe('2026-05-04T01:00:00Z:7');

		// 同日 2 回目 (dispatcher の retry / 手動再実行)。settingsStore は clear しない =
		// マーカーが残った状態で同じテナントをもう一度走らせる
		mockSendRenewal.mockClear();
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: '2026-05-04T01:00:00Z',
			}),
		);
		const second = await runLifecycleEmails({ now: NOW });
		expect(second.renewalSent).toBe(0);
		expect(mockSendRenewal).not.toHaveBeenCalled();
	});

	// 送信に失敗した回はマーカーを立てず、次回実行で再試行される。
	it('#4721 送信に失敗した回はマーカーを立てない', async () => {
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: '2026-05-04T01:00:00Z',
			}),
		);
		mockSendRenewal.mockResolvedValueOnce(false);

		await runLifecycleEmails({ now: NOW });

		expect(settingsStore.get('t-1:renewal_reminder_sent_marker')).toBeUndefined();
	});

	it('残り 14 日 (catch-up 窓の外) は送らない', async () => {
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

// ============================================================
// #4416 dunning 猶予の残り日数リマインド
// ============================================================

describe('#4416 dunning 猶予の「残り N 日」は猶予終了日の据え置きに依存する', () => {
	// 猶予終了日 (`plan_expires_at`) を読む唯一の顧客向け処理が本リマインド。
	// stripe-service の W3 / W4 が retry のたびに `now + 7d` を書き直すと、
	// 残り日数が 7 に張り付いて最終通知 (残り 1 日) が永久に届かない。
	// 「据え置きなら数え下がる / 与え直しなら張り付く」を実サービスで固定する。
	// W3 / W4 が実際に据え置くことは
	// `stripe-contract-state-classification.test.ts` (#4416) が handler を駆動して固定する。
	const FIRST_FAILURE = new Date('2026-04-27T01:00:00Z');
	const GRACE_DAYS = 7;
	const plusDays = (base: Date, days: number) =>
		new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

	/** 猶予 6 日目 (残り 1 日)。 */
	const SIXTH_DAY = plusDays(FIRST_FAILURE, 6);

	it('据え置きなら猶予 6 日目に「残り 1 日」の最終リマインドが届く', async () => {
		const fixedExpiry = plusDays(FIRST_FAILURE, GRACE_DAYS).toISOString();
		setupSingleTenantWithOwner(
			makeTenant({ plan: 'standard_monthly', planExpiresAt: fixedExpiry }),
		);

		const result = await runLifecycleEmails({ now: SIXTH_DAY });

		expect(result.renewalSent, '最終リマインドが送られていない').toBe(1);
		expect(mockSendRenewal).toHaveBeenCalledWith(expect.objectContaining({ daysRemaining: 1 }));
	});

	it('retry ごとに猶予終了日を与え直すと「残り 1 日」に到達しない', async () => {
		// 旧 W3 の挙動 (無条件 `now + 7d`) を入力として再現する。6 日目に retry が来て
		// 猶予終了日が「6 日目 + 7 日」に書き換わっている状態。
		setupSingleTenantWithOwner(
			makeTenant({
				plan: 'standard_monthly',
				planExpiresAt: plusDays(SIXTH_DAY, GRACE_DAYS).toISOString(),
			}),
		);

		const result = await runLifecycleEmails({ now: SIXTH_DAY });

		expect(result.renewalSent, '残り 7 日として再送されている').toBe(1);
		expect(mockSendRenewal).toHaveBeenCalledWith(
			expect.objectContaining({ daysRemaining: GRACE_DAYS }),
		);
		expect(
			mockSendRenewal,
			'与え直しでも残り 1 日が届くなら本 test は意味を失っている',
		).not.toHaveBeenCalledWith(expect.objectContaining({ daysRemaining: 1 }));
	});
});
