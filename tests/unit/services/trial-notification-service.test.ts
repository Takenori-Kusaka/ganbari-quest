// tests/unit/services/trial-notification-service.test.ts
// #737: トライアル通知サービスのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks ---

const mockGetTrialStatus = vi.fn();
const mockFindTenantById = vi.fn();
const mockFindTenantMembers = vi.fn();
const mockFindUserById = vi.fn();
const mockFindArchivedChildren = vi.fn();
const mockGetSettings = vi.fn();
// #4721: 送信済マーカーの読み取り。既定 undefined = 未送信
const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantById: mockFindTenantById,
			findTenantMembers: mockFindTenantMembers,
			findUserById: mockFindUserById,
		},
		child: {
			findArchivedChildren: mockFindArchivedChildren,
		},
		settings: {
			getSettings: mockGetSettings,
			getSetting: mockGetSetting,
			setSetting: mockSetSetting,
		},
	}),
}));

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: (...args: unknown[]) => mockGetTrialStatus(...args),
}));

const mockSendEmail = vi.fn().mockResolvedValue(true);
vi.mock('$lib/server/services/email-service', () => ({
	sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('$lib/server/request-context', () => ({
	getRequestContext: () => null,
	invalidateRequestCaches: vi.fn(),
}));

// #4482: 保持期間の値 / 整形の SSOT
import {
	formatRetentionPeriod,
	PLAN_HISTORY_RETENTION_DAYS,
} from '$lib/domain/constants/plan-retention';
import { TRIAL_EMAIL_LABELS } from '$lib/domain/labels';
import {
	getNotificationSchedule,
	getTrialExpirationInfo,
	markTrialExpirationModalShown,
	processTrialNotifications,
	sendTrialEndedTodayEmail,
	sendTrialEnding1DayEmail,
	sendTrialEnding3DaysEmail,
} from '$lib/server/services/trial-notification-service';

describe('trial-notification-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ============================================================
	// getNotificationSchedule
	// ============================================================

	describe('getNotificationSchedule', () => {
		it('トライアル非アクティブなら null を返す', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: false,
				trialUsed: false,
				trialStartDate: null,
				trialEndDate: null,
				trialTier: null,
				daysRemaining: 0,
				source: null,
			});

			const result = await getNotificationSchedule('tenant-1');
			expect(result).toBeNull();
		});

		it('残り3日で trial_ending_3days 通知を返す', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-20',
				trialTier: 'standard',
				daysRemaining: 3,
				source: 'user_initiated',
			});

			const result = await getNotificationSchedule('tenant-1');
			expect(result).not.toBeNull();
			expect(result?.notifications).toEqual(['trial_ending_3days']);
			expect(result?.daysRemaining).toBe(3);
		});

		it('残り1日で trial_ending_1day 通知を返す', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-18',
				trialTier: 'family',
				daysRemaining: 1,
				source: 'user_initiated',
			});

			const result = await getNotificationSchedule('tenant-1');
			expect(result?.notifications).toEqual(['trial_ending_1day']);
			expect(result?.trialTier).toBe('family');
		});

		it('残り0日で trial_ended_today 通知を返す', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-17',
				trialTier: 'standard',
				daysRemaining: 0,
				source: 'user_initiated',
			});

			const result = await getNotificationSchedule('tenant-1');
			expect(result?.notifications).toEqual(['trial_ended_today']);
		});

		it('残り5日の場合は通知なし (null)', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-22',
				trialTier: 'standard',
				daysRemaining: 5,
				source: 'user_initiated',
			});

			const result = await getNotificationSchedule('tenant-1');
			expect(result).toBeNull();
		});
	});

	// ============================================================
	// Email sending
	// ============================================================

	describe('sendTrialEnding3DaysEmail', () => {
		it('standard プランの3日前メールを送信する', async () => {
			const result = await sendTrialEnding3DaysEmail('test@example.com', '2026-04-20', 'standard');
			expect(result).toBe(true);
			expect(mockSendEmail).toHaveBeenCalledTimes(1);
			const call = mockSendEmail.mock.calls[0]?.[0];
			expect(call.to).toBe('test@example.com');
			expect(call.subject).toContain('残り3日');
			expect(call.htmlBody).toContain('スタンダード');
		});

		it('family プランの3日前メールを送信する', async () => {
			await sendTrialEnding3DaysEmail('test@example.com', '2026-04-20', 'family');
			const call = mockSendEmail.mock.calls[0]?.[0];
			expect(call.htmlBody).toContain('プレミアム');
		});

		// #4482: 保持期間の「整形」も SSOT (formatRetentionPeriod) を経由する。
		// 以前は `${historyRetentionDays}日` と service 内で独自整形していたため、
		// 保持日数を 365 の倍数にすると LP / 料金表は「1年」なのにこのメールだけ
		// 「365日」と述べる食い違いが起きた。
		it('保持期間を SSOT の formatter で整形して述べる (#4482)', async () => {
			await sendTrialEnding3DaysEmail('test@example.com', '2026-04-20', 'standard');
			const call = mockSendEmail.mock.calls[0]?.[0];
			const freeDays = PLAN_HISTORY_RETENTION_DAYS.free;

			// SSOT の値を 365 の倍数に変えれば期待値は「1年」になり、
			// 独自整形 (`365日`) に戻した瞬間この assert が落ちる。
			//
			// #4507: 行の文言は「データ保持期間」→「履歴（記録）の保持期間」に変わった
			// (消えるのは活動記録などの履歴だけで、アカウント自体ではないため)。
			// ここで文面を再度ハードコードすると label SSOT と二重管理になるので、
			// **label の出力そのもの**と突き合わせる。service が label を経由せず
			// 自前で組み立てに戻れば、この assert が落ちる。
			expect(call.htmlBody).toContain(TRIAL_EMAIL_LABELS.freeRetentionLine(freeDays));
			// label 側が formatter を捨てて独自整形に戻る経路も塞ぐ (#4482 の本来の担保)
			expect(TRIAL_EMAIL_LABELS.freeRetentionLine(freeDays)).toContain(
				formatRetentionPeriod(freeDays),
			);
		});

		// #4507: 旧文面は「データは削除されません」「いつでも復元できます」と無条件に
		// 約束していたが、無料プラン復帰後の履歴は保持期間超過分が物理削除される。
		// 3 通が互いに食い違わないよう、シリーズ全通で復元不能を述べることを固定する。
		it('保持期間を過ぎた履歴が復元できないことを述べる (#4507)', async () => {
			await sendTrialEnding3DaysEmail('test@example.com', '2026-04-20', 'standard');
			const call = mockSendEmail.mock.calls[0]?.[0];
			const freeDays = PLAN_HISTORY_RETENTION_DAYS.free;

			expect(call.htmlBody).toContain(TRIAL_EMAIL_LABELS.retentionIrreversibleLine(freeDays));
			// 「閲覧不可」等への婉曲化を禁じる (実装は物理削除であり閲覧可否の話ではない)
			expect(call.htmlBody).toContain('復元できません');
			expect(call.htmlBody).not.toContain('データは削除されません');
		});
	});

	describe('sendTrialEnding1DayEmail', () => {
		it('1日前メールを送信する', async () => {
			const result = await sendTrialEnding1DayEmail('test@example.com', '2026-04-18', 'standard');
			expect(result).toBe(true);
			const call = mockSendEmail.mock.calls[0]?.[0];
			expect(call.subject).toContain('明日終了');
		});
	});

	describe('sendTrialEndedTodayEmail', () => {
		it('当日メールを送信する', async () => {
			const result = await sendTrialEndedTodayEmail('test@example.com', 'family');
			expect(result).toBe(true);
			const call = mockSendEmail.mock.calls[0]?.[0];
			expect(call.subject).toContain('終了しました');
			expect(call.htmlBody).toContain('プレミアム');
		});
	});

	// ============================================================
	// getTrialExpirationInfo
	// ============================================================

	describe('getTrialExpirationInfo', () => {
		it('トライアル未使用ならモーダル非表示', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: false,
				trialUsed: false,
				trialStartDate: null,
				trialEndDate: null,
				trialTier: null,
				daysRemaining: 0,
				source: null,
			});

			const result = await getTrialExpirationInfo('tenant-1', 'none');
			expect(result.isExpired).toBe(false);
			expect(result.showExpirationModal).toBe(false);
		});

		it('トライアルアクティブ中ならモーダル非表示', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-20',
				trialTier: 'standard',
				daysRemaining: 3,
				source: 'user_initiated',
			});

			const result = await getTrialExpirationInfo('tenant-1', 'none');
			expect(result.isExpired).toBe(false);
			expect(result.showExpirationModal).toBe(false);
		});

		it('有料プランアクティブならモーダル非表示', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: false,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-17',
				trialTier: 'standard',
				daysRemaining: 0,
				source: 'user_initiated',
			});

			const result = await getTrialExpirationInfo('tenant-1', 'active');
			expect(result.isExpired).toBe(false);
			expect(result.showExpirationModal).toBe(false);
		});

		it('トライアル終了後の初回ログインでモーダル表示', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: false,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-17',
				trialTier: 'standard',
				daysRemaining: 0,
				source: 'user_initiated',
			});
			mockGetSettings.mockResolvedValue({});
			mockFindArchivedChildren.mockResolvedValue([{ id: '3', nickname: 'child3' }]);

			const result = await getTrialExpirationInfo('tenant-1', 'none');
			expect(result.isExpired).toBe(true);
			expect(result.showExpirationModal).toBe(true);
			expect(result.trialTier).toBe('standard');
			expect(result.archivedResourceCount).toBe(1);
		});

		it('モーダル表示済みなら再表示しない', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: false,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-17',
				trialTier: 'standard',
				daysRemaining: 0,
				source: 'user_initiated',
			});
			mockGetSettings.mockResolvedValue({
				trial_expiration_modal_shown: 'true',
			});
			mockFindArchivedChildren.mockResolvedValue([]);

			const result = await getTrialExpirationInfo('tenant-1', 'none');
			expect(result.isExpired).toBe(true);
			expect(result.showExpirationModal).toBe(false);
		});
	});

	// ============================================================
	// markTrialExpirationModalShown
	// ============================================================

	describe('markTrialExpirationModalShown', () => {
		it('settings にフラグを保存する', async () => {
			await markTrialExpirationModalShown('tenant-1');
			expect(mockSetSetting).toHaveBeenCalledWith(
				'trial_expiration_modal_shown',
				'true',
				'tenant-1',
			);
		});
	});

	// ============================================================
	// processTrialNotifications
	// ============================================================

	describe('processTrialNotifications', () => {
		it('通知対象テナントにメールを送信する', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-20',
				trialTier: 'standard',
				daysRemaining: 3,
				source: 'user_initiated',
			});
			mockFindTenantById.mockResolvedValue({ tenantId: 'tenant-1', name: 'Test' });
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'user-1', tenantId: 'tenant-1', role: 'owner' },
			]);
			mockFindUserById.mockResolvedValue({ userId: 'user-1', email: 'owner@example.com' });

			const result = await processTrialNotifications(['tenant-1']);
			expect(result.sent).toBe(1);
			expect(result.skipped).toBe(0);
			expect(result.errors).toBe(0);
		});

		// #4721: dispatcher の Lambda 非同期 retry / 手動再実行で同じ通知が 2 通届いていた。
		// マーカーの値をトライアル終了日にすることで「同じ契約の同じ通知は 1 通」を保証する。
		it('#4721 送信済マーカーがあれば同じ通知を再送しない', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-20',
				trialTier: 'standard',
				daysRemaining: 3,
				source: 'user_initiated',
			});
			mockFindTenantById.mockResolvedValue({ tenantId: 'tenant-1', name: 'Test' });
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'user-1', tenantId: 'tenant-1', role: 'owner' },
			]);
			mockFindUserById.mockResolvedValue({ userId: 'user-1', email: 'owner@example.com' });
			// 同じトライアル終了日で既に送信済
			mockGetSetting.mockResolvedValue('2026-04-20');

			const result = await processTrialNotifications(['tenant-1']);

			expect(result.sent).toBe(0);
			expect(result.skipped).toBe(1);
			expect(mockSetSetting).not.toHaveBeenCalled();
		});

		// マーカーの値がトライアル終了日なので、新しいトライアルなら再び届く
		// (値を「送った日付」にすると、翌日にもう 1 通出てしまう)。
		it('#4721 別のトライアル (終了日が違う) なら送る', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-06-10',
				trialEndDate: '2026-06-20',
				trialTier: 'standard',
				daysRemaining: 3,
				source: 'user_initiated',
			});
			mockFindTenantById.mockResolvedValue({ tenantId: 'tenant-1', name: 'Test' });
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'user-1', tenantId: 'tenant-1', role: 'owner' },
			]);
			mockFindUserById.mockResolvedValue({ userId: 'user-1', email: 'owner@example.com' });
			// 前回のトライアルの終了日が残っている
			mockGetSetting.mockResolvedValue('2026-04-20');

			const result = await processTrialNotifications(['tenant-1']);

			expect(result.sent).toBe(1);
			expect(mockSetSetting).toHaveBeenCalledWith(
				'trial_notif_sent_trial_ending_3days',
				'2026-06-20',
				'tenant-1',
			);
		});

		it('通知対象外のテナントはスキップする', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: false,
				trialUsed: false,
				trialStartDate: null,
				trialEndDate: null,
				trialTier: null,
				daysRemaining: 0,
				source: null,
			});

			const result = await processTrialNotifications(['tenant-1']);
			expect(result.sent).toBe(0);
			expect(result.skipped).toBe(1);
		});

		it('オーナーが見つからない場合はスキップする', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-10',
				trialEndDate: '2026-04-20',
				trialTier: 'standard',
				daysRemaining: 3,
				source: 'user_initiated',
			});
			mockFindTenantById.mockResolvedValue({ tenantId: 'tenant-1', name: 'Test' });
			mockFindTenantMembers.mockResolvedValue([]);

			const result = await processTrialNotifications(['tenant-1']);
			expect(result.skipped).toBe(1);
		});
	});
});
