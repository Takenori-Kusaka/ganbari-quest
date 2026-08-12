// tests/unit/services/email-wiring.test.ts
// #4507 (GAMMA 監査 R2 #2 / #3): 通知経路の**配線**を固定する。
//
// 文言そのものは email-content-snapshot.test.ts が見る。こちらは
//   「支払い失敗中の顧客に、配信停止していても通知が届くか」
//   「退会したとき、予約時と削除完了時に通知が届くか」
// という**送られる / 送られない**の分岐だけを検証する。
//
// どちらも旧実装では「送られない」が既定だった (dunning は marketing 便で opt-out に
// 抑止され、退会は両端とも未配線) ため、無音に戻ったことを検出できる test を残す。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// mocks
// ============================================================

const mockSendPaymentFailed = vi.fn().mockResolvedValue(true);
const mockSendRenewalReminder = vi.fn().mockResolvedValue(true);
const mockSendDormant = vi.fn().mockResolvedValue(true);
const mockSendDeletionReserved = vi.fn().mockResolvedValue(true);

vi.mock('$lib/server/services/email-service', () => ({
	sendPaymentFailedNoticeEmail: (p: unknown) => mockSendPaymentFailed(p),
	sendLicenseRenewalReminderEmail: (p: unknown) => mockSendRenewalReminder(p),
	sendDormantReactivationEmail: (p: unknown) => mockSendDormant(p),
	sendDeletionReservedEmail: (p: unknown) => mockSendDeletionReserved(p),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockCanSendMarketing = vi.fn().mockResolvedValue(true);
const mockIncrementMarketing = vi.fn().mockResolvedValue(undefined);

vi.mock('$lib/server/services/marketing-email-counter', () => ({
	canSendMarketingEmail: () => mockCanSendMarketing(),
	incrementMarketingEmailCount: (id: string) => mockIncrementMarketing(id),
}));

/** settings KV の中身 (opt-out 等) をテストごとに差し替える。 */
let settingsStore: Record<string, string> = {};
const tenants: Array<Record<string, unknown>> = [];

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			listAllTenants: async () => tenants,
			findTenantMembers: async () => [{ userId: 'owner-1', role: 'owner' }],
			findUserById: async () => ({ email: 'owner@example.com', displayName: 'やまだ' }),
			findTenantById: async () => ({ name: 'やまだ家' }),
		},
		// resolveFullPlanTier → getTrialStatus が読む (トライアル履歴なし = 通常の有料プラン)
		trialHistory: { findLatestByTenant: async () => null },
		settings: {
			getSetting: async (key: string) => settingsStore[key],
			setSetting: async (key: string, value: string) => {
				settingsStore[key] = value;
			},
		},
	}),
}));

import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { runLifecycleEmails } from '$lib/server/services/lifecycle-email-service';
import { MARKETING_UNSUBSCRIBED_KEY } from '$lib/server/services/marketing-suppression-keys';

// ============================================================
// #2: dunning 通知はトランザクション便
// ============================================================

const NOW = new Date('2026-09-23T00:00:00.000Z');
/** NOW から残り 7 日 (期限前リマインドの送信日のひとつ) */
const EXPIRES_IN_7_DAYS = '2026-09-30T00:00:00.000Z';

function seedTenant(status: string): void {
	tenants.length = 0;
	tenants.push({
		tenantId: 'tenant-1',
		name: 'やまだ家',
		status,
		plan: 'monthly',
		planExpiresAt: EXPIRES_IN_7_DAYS,
		lastActiveAt: '2026-09-22T00:00:00.000Z',
		createdAt: '2026-01-01T00:00:00.000Z',
	});
}

describe('支払い失敗 (dunning) の通知経路 (#4507 監査 #2)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCanSendMarketing.mockResolvedValue(true);
		settingsStore = {};
	});

	it('grace_period のテナントには支払い失敗の通知を送る (期限前リマインドではなく)', async () => {
		seedTenant(SUBSCRIPTION_STATUS.GRACE_PERIOD);

		const result = await runLifecycleEmails({ now: NOW });

		expect(mockSendPaymentFailed).toHaveBeenCalledTimes(1);
		expect(mockSendRenewalReminder).not.toHaveBeenCalled();
		expect(result.paymentFailedSent).toBe(1);
		expect(result.renewalSent).toBe(0);
	});

	it('配信停止 (opt-out) 済みでも支払い失敗の通知は届く', async () => {
		seedTenant(SUBSCRIPTION_STATUS.GRACE_PERIOD);
		settingsStore[MARKETING_UNSUBSCRIBED_KEY] = '2026-01-01T00:00:00.000Z';

		const result = await runLifecycleEmails({ now: NOW });

		expect(mockSendPaymentFailed).toHaveBeenCalledTimes(1);
		expect(result.skippedUnsubscribed).toBe(0);
	});

	it('年 6 回上限に達していても支払い失敗の通知は届き、上限枠も消費しない', async () => {
		seedTenant(SUBSCRIPTION_STATUS.GRACE_PERIOD);
		mockCanSendMarketing.mockResolvedValue(false);

		const result = await runLifecycleEmails({ now: NOW });

		expect(mockSendPaymentFailed).toHaveBeenCalledTimes(1);
		expect(mockIncrementMarketing).not.toHaveBeenCalled();
		expect(result.skippedRateLimit).toBe(0);
	});

	// #4507: 年 6 回上限を外した = 重複送信を止めるものが他に無い。cron-dispatcher は
	// retry を内蔵しているため、同日 2 回実行で同じ文面が 2 通届く経路が実在する。
	it('同じ日に cron が 2 回走っても支払い失敗の通知は 1 通しか送らない', async () => {
		seedTenant(SUBSCRIPTION_STATUS.GRACE_PERIOD);

		await runLifecycleEmails({ now: NOW });
		await runLifecycleEmails({ now: NOW });

		expect(mockSendPaymentFailed).toHaveBeenCalledTimes(1);
	});

	it('同じ猶予期間でも残日数が変われば送る (残り7日 → 残り1日)', async () => {
		seedTenant(SUBSCRIPTION_STATUS.GRACE_PERIOD);

		await runLifecycleEmails({ now: NOW });
		// 残り 1 日の cron 実行日まで進める
		await runLifecycleEmails({ now: new Date('2026-09-29T00:00:00.000Z') });

		expect(mockSendPaymentFailed).toHaveBeenCalledTimes(2);
		const daysSent = mockSendPaymentFailed.mock.calls.map(
			(c) => (c[0] as { daysRemaining: number } | undefined)?.daysRemaining,
		);
		expect(daysSent).toEqual([7, 1]);
	});

	it('送信に失敗した回は送信済にせず、次の実行で送り直す', async () => {
		seedTenant(SUBSCRIPTION_STATUS.GRACE_PERIOD);
		mockSendPaymentFailed.mockResolvedValueOnce(false);

		const first = await runLifecycleEmails({ now: NOW });
		const second = await runLifecycleEmails({ now: NOW });

		expect(first.errors).toBe(1);
		expect(second.paymentFailedSent).toBe(1);
		expect(mockSendPaymentFailed).toHaveBeenCalledTimes(2);
	});

	it('次の支払い失敗 (猶予期限が変わる) では再び送る', async () => {
		seedTenant(SUBSCRIPTION_STATUS.GRACE_PERIOD);
		await runLifecycleEmails({ now: NOW });

		// 新しい dunning サイクル: planExpiresAt が書き換わる
		const seeded = tenants[0];
		if (!seeded) throw new Error('テナントが seed されていません');
		seeded.planExpiresAt = '2026-12-30T00:00:00.000Z';
		await runLifecycleEmails({ now: new Date('2026-12-23T00:00:00.000Z') });

		expect(mockSendPaymentFailed).toHaveBeenCalledTimes(2);
	});

	it('通常の active テナントには従来どおり期限前リマインド (marketing 便) を送る', async () => {
		seedTenant(SUBSCRIPTION_STATUS.ACTIVE);

		const result = await runLifecycleEmails({ now: NOW });

		expect(mockSendRenewalReminder).toHaveBeenCalledTimes(1);
		expect(mockSendPaymentFailed).not.toHaveBeenCalled();
		expect(mockIncrementMarketing).toHaveBeenCalledTimes(1);
		expect(result.renewalSent).toBe(1);
	});

	it('active テナントの期限前リマインドは配信停止で止まる (marketing 便のまま)', async () => {
		seedTenant(SUBSCRIPTION_STATUS.ACTIVE);
		settingsStore[MARKETING_UNSUBSCRIBED_KEY] = '2026-01-01T00:00:00.000Z';

		const result = await runLifecycleEmails({ now: NOW });

		expect(mockSendRenewalReminder).not.toHaveBeenCalled();
		expect(result.skippedUnsubscribed).toBe(1);
	});
});

// ============================================================
// #3: 退会予約の通知
// ============================================================

describe('退会予約の通知経路 (#4507 監査 #3)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		settingsStore = {};
	});

	it('猶予期間つきの退会予約でオーナーに受付通知を送る', async () => {
		const { softDeleteTenant } = await import('$lib/server/services/grace-period-service');

		const result = await softDeleteTenant('tenant-1', 'active', 'monthly');

		expect(result.requiresImmediateDeletion).toBe(false);
		expect(mockSendDeletionReserved).toHaveBeenCalledTimes(1);
		const params = mockSendDeletionReserved.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(params.email).toBe('owner@example.com');
		expect(params.graceDays).toBe(result.gracePeriodDays);
	});

	it('通知の送信に失敗しても退会予約は成立する (削除を止めない)', async () => {
		mockSendDeletionReserved.mockRejectedValueOnce(new Error('SES down'));
		const { softDeleteTenant } = await import('$lib/server/services/grace-period-service');

		const result = await softDeleteTenant('tenant-1', 'active', 'monthly');

		expect(result.success).toBe(true);
	});
});
