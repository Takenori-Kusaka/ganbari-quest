import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock push-subscription-repo
vi.mock('$lib/server/db/push-subscription-repo', () => ({
	findByTenant: vi.fn(),
	findByEndpoint: vi.fn(),
	insert: vi.fn(),
	deleteByEndpoint: vi.fn(),
	insertLog: vi.fn(),
	countTodayLogs: vi.fn(),
	findRecentLogs: vi.fn(),
}));

// Mock settings-repo
vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: vi.fn(),
	setSetting: vi.fn(),
	getSettings: vi.fn(),
}));

// Mock web-push
vi.mock('web-push', () => ({
	default: {
		setVapidDetails: vi.fn(),
		sendNotification: vi.fn(),
	},
}));

// Mock logger
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import webpush from 'web-push';
import {
	countTodayLogs,
	deleteByEndpoint,
	findByTenant,
	insertLog,
} from '$lib/server/db/push-subscription-repo';
import { getSettings } from '$lib/server/db/settings-repo';
import {
	canSendNotification,
	getNotificationSettings,
	isQuietHours,
	sendAchievementNotification,
	sendPushNotification,
} from '$lib/server/services/notification-service';

const mockFindByTenant = vi.mocked(findByTenant);
const mockDeleteByEndpoint = vi.mocked(deleteByEndpoint);
const mockInsertLog = vi.mocked(insertLog);
const mockCountTodayLogs = vi.mocked(countTodayLogs);
const mockGetSettings = vi.mocked(getSettings);
const mockSendNotification = vi.mocked(webpush.sendNotification);

describe('notification-service', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		process.env.AUTH_MODE = 'cognito';
		process.env.VAPID_PUBLIC_KEY = 'test-public-key';
		process.env.VAPID_PRIVATE_KEY = 'test-private-key';
		process.env.VAPID_SUBJECT = 'mailto:test@example.com';

		mockGetSettings.mockResolvedValue({});
		mockInsertLog.mockResolvedValue({
			id: 1,
			tenantId: 'T1',
			notificationType: 'test',
			title: 'test',
			body: 'test',
			sentAt: '2026-04-01T12:00:00.000Z',
			success: 1,
			errorMessage: null,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		process.env.AUTH_MODE = undefined;
		process.env.VAPID_PUBLIC_KEY = undefined;
		process.env.VAPID_PRIVATE_KEY = undefined;
		process.env.VAPID_SUBJECT = undefined;
	});

	/** 昼間 JST (12:00 JST = 03:00 UTC) にタイマーを設定 */
	function setDaytimeJST() {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-04-01T03:00:00Z'));
	}

	// ============================================================
	// isQuietHours
	// ============================================================

	describe('isQuietHours', () => {
		it('21:00-07:00 ラップアラウンド: 22:00 JST はサイレント', () => {
			const date = new Date('2026-04-01T13:00:00Z'); // 22:00 JST
			expect(isQuietHours(date, '21:00', '07:00')).toBe(true);
		});

		it('21:00-07:00 ラップアラウンド: 03:00 JST はサイレント', () => {
			const date = new Date('2026-04-01T18:00:00Z'); // 03:00 JST
			expect(isQuietHours(date, '21:00', '07:00')).toBe(true);
		});

		it('21:00-07:00 ラップアラウンド: 12:00 JST は非サイレント', () => {
			const date = new Date('2026-04-01T03:00:00Z'); // 12:00 JST
			expect(isQuietHours(date, '21:00', '07:00')).toBe(false);
		});

		it('21:00-07:00 ラップアラウンド: 20:59 JST は非サイレント', () => {
			const date = new Date('2026-04-01T11:59:00Z'); // 20:59 JST
			expect(isQuietHours(date, '21:00', '07:00')).toBe(false);
		});

		it('09:00-17:00 通常範囲: 12:00 JST はサイレント', () => {
			const date = new Date('2026-04-01T03:00:00Z'); // 12:00 JST
			expect(isQuietHours(date, '09:00', '17:00')).toBe(true);
		});

		it('09:00-17:00 通常範囲: 08:00 JST は非サイレント', () => {
			const date = new Date('2026-03-31T23:00:00Z'); // 08:00 JST
			expect(isQuietHours(date, '09:00', '17:00')).toBe(false);
		});
	});

	// ============================================================
	// getNotificationSettings
	// ============================================================

	describe('getNotificationSettings', () => {
		it('デフォルト値を返す（設定未保存時）', async () => {
			mockGetSettings.mockResolvedValue({});
			const s = await getNotificationSettings('T1');
			expect(s.remindersEnabled).toBe(true);
			expect(s.reminderTime).toBe('09:00');
			expect(s.streakEnabled).toBe(true);
			expect(s.achievementsEnabled).toBe(true);
			expect(s.quietStart).toBe('21:00');
			expect(s.quietEnd).toBe('07:00');
		});

		it('保存済み値を返す', async () => {
			mockGetSettings.mockResolvedValue({
				notification_reminders_enabled: 'false',
				notification_reminder_time: '08:00',
				notification_achievements_enabled: 'false',
				notification_quiet_start: '22:00',
				notification_quiet_end: '06:00',
			});
			const s = await getNotificationSettings('T1');
			expect(s.remindersEnabled).toBe(false);
			expect(s.reminderTime).toBe('08:00');
			expect(s.achievementsEnabled).toBe(false);
			expect(s.quietStart).toBe('22:00');
			expect(s.quietEnd).toBe('06:00');
		});
	});

	// ============================================================
	// canSendNotification
	// ============================================================

	describe('canSendNotification', () => {
		it('3通以上送信済みの場合 false', async () => {
			setDaytimeJST();
			mockCountTodayLogs.mockResolvedValue(3);
			expect(await canSendNotification('T1')).toBe(false);
		});

		it('制限内＋非サイレント時間帯で true', async () => {
			setDaytimeJST();
			mockCountTodayLogs.mockResolvedValue(1);
			expect(await canSendNotification('T1')).toBe(true);
		});

		it('サイレント時間帯で false', async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-04-01T13:00:00Z')); // 22:00 JST
			mockCountTodayLogs.mockResolvedValue(0);
			expect(await canSendNotification('T1')).toBe(false);
		});
	});

	// ============================================================
	// sendPushNotification
	// ============================================================

	describe('sendPushNotification', () => {
		it('ローカルモード: ログ出力のみ（web-push呼ばない）', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await sendPushNotification('T1', 'test', 'Title', 'Body');
			expect(result).toEqual({ sent: 1, failed: 0 });
			expect(mockSendNotification).not.toHaveBeenCalled();
			expect(mockInsertLog).toHaveBeenCalledWith(
				expect.objectContaining({ tenantId: 'T1', notificationType: 'test', success: true }),
			);
		});

		it('全subscription宛に送信', async () => {
			setDaytimeJST();
			mockCountTodayLogs.mockResolvedValue(0);
			mockFindByTenant.mockResolvedValue([
				{
					id: 1,
					tenantId: 'T1',
					endpoint: 'https://push1',
					keysP256dh: 'p1',
					keysAuth: 'a1',
					userAgent: null,
					subscriberRole: 'parent',
					createdAt: '',
				},
				{
					id: 2,
					tenantId: 'T1',
					endpoint: 'https://push2',
					keysP256dh: 'p2',
					keysAuth: 'a2',
					userAgent: null,
					subscriberRole: 'owner',
					createdAt: '',
				},
			]);
			mockSendNotification.mockResolvedValue({} as never);

			const result = await sendPushNotification('T1', 'test', 'Title', 'Body');
			expect(result.sent).toBe(2);
			expect(result.failed).toBe(0);
			expect(mockSendNotification).toHaveBeenCalledTimes(2);
		});

		it('410応答で stale subscription を削除', async () => {
			setDaytimeJST();
			mockCountTodayLogs.mockResolvedValue(0);
			mockFindByTenant.mockResolvedValue([
				{
					id: 1,
					tenantId: 'T1',
					endpoint: 'https://stale',
					keysP256dh: 'p1',
					keysAuth: 'a1',
					userAgent: null,
					subscriberRole: 'parent',
					createdAt: '',
				},
			]);
			mockSendNotification.mockRejectedValue({ statusCode: 410 });

			const result = await sendPushNotification('T1', 'test', 'Title', 'Body');
			expect(result.sent).toBe(0);
			expect(result.failed).toBe(1);
			expect(mockDeleteByEndpoint).toHaveBeenCalledWith('https://stale', 'T1');
		});

		// ============================================================
		// #1593 (ADR-0023 I6): Anti-engagement / COPPA 構造的防御
		// ============================================================

		it('#1593 child role の subscription への送信を二重防御で skip', async () => {
			setDaytimeJST();
			mockCountTodayLogs.mockResolvedValue(0);
			mockFindByTenant.mockResolvedValue([
				{
					id: 1,
					tenantId: 'T1',
					endpoint: 'https://parent-device',
					keysP256dh: 'p1',
					keysAuth: 'a1',
					userAgent: null,
					subscriberRole: 'parent',
					createdAt: '',
				},
				{
					id: 2,
					tenantId: 'T1',
					endpoint: 'https://child-device',
					keysP256dh: 'p2',
					keysAuth: 'a2',
					userAgent: null,
					// NOTE: 型上は parent | owner だが、過去レコードや bug 経由で混入した
					// 想定で `as never` キャストして child を注入 (二重防御の検証目的)。
					subscriberRole: 'child' as never,
					createdAt: '',
				},
			]);
			mockSendNotification.mockResolvedValue({} as never);

			const result = await sendPushNotification('T1', 'test', 'Title', 'Body');
			// 親端末のみ送信、子端末は skip
			expect(result.sent).toBe(1);
			expect(result.failed).toBe(0);
			expect(mockSendNotification).toHaveBeenCalledTimes(1);
			// child 端末の endpoint には絶対に送られない
			const calledEndpoints = mockSendNotification.mock.calls.map(
				(call) => (call[0] as { endpoint: string }).endpoint,
			);
			expect(calledEndpoints).toContain('https://parent-device');
			expect(calledEndpoints).not.toContain('https://child-device');
		});

		it('#1593 不明な subscriber_role の subscription への送信を skip', async () => {
			setDaytimeJST();
			mockCountTodayLogs.mockResolvedValue(0);
			mockFindByTenant.mockResolvedValue([
				{
					id: 1,
					tenantId: 'T1',
					endpoint: 'https://unknown-role-device',
					keysP256dh: 'p1',
					keysAuth: 'a1',
					userAgent: null,
					subscriberRole: 'guest' as never, // 想定外 role
					createdAt: '',
				},
			]);
			mockSendNotification.mockResolvedValue({} as never);

			const result = await sendPushNotification('T1', 'test', 'Title', 'Body');
			// 全 subscription が想定外 role → 0 件送信
			expect(result.sent).toBe(0);
			expect(result.failed).toBe(0);
			expect(mockSendNotification).not.toHaveBeenCalled();
		});

		it('#1593 全 subscription が child role の場合 0 件で完結', async () => {
			setDaytimeJST();
			mockCountTodayLogs.mockResolvedValue(0);
			mockFindByTenant.mockResolvedValue([
				{
					id: 1,
					tenantId: 'T1',
					endpoint: 'https://child1',
					keysP256dh: 'p1',
					keysAuth: 'a1',
					userAgent: null,
					subscriberRole: 'child' as never,
					createdAt: '',
				},
				{
					id: 2,
					tenantId: 'T1',
					endpoint: 'https://child2',
					keysP256dh: 'p2',
					keysAuth: 'a2',
					userAgent: null,
					subscriberRole: 'child' as never,
					createdAt: '',
				},
			]);

			const result = await sendPushNotification('T1', 'test', 'Title', 'Body');
			expect(result).toEqual({ sent: 0, failed: 0 });
			expect(mockSendNotification).not.toHaveBeenCalled();
		});

		it('VAPID未設定時はスキップ', async () => {
			setDaytimeJST();
			process.env.VAPID_PUBLIC_KEY = '';
			process.env.VAPID_PRIVATE_KEY = '';
			mockCountTodayLogs.mockResolvedValue(0);

			const result = await sendPushNotification('T1', 'test', 'Title', 'Body');
			expect(result).toEqual({ sent: 0, failed: 0 });
			expect(mockSendNotification).not.toHaveBeenCalled();
		});

		it('subscription なしの場合 0 件返却', async () => {
			setDaytimeJST();
			mockCountTodayLogs.mockResolvedValue(0);
			mockFindByTenant.mockResolvedValue([]);

			const result = await sendPushNotification('T1', 'test', 'Title', 'Body');
			expect(result).toEqual({ sent: 0, failed: 0 });
		});
	});

	// ============================================================
	// sendAchievementNotification
	// ============================================================

	describe('sendAchievementNotification', () => {
		it('achievements無効時はスキップ', async () => {
			mockGetSettings.mockResolvedValue({ notification_achievements_enabled: 'false' });
			await sendAchievementNotification('T1', {
				childName: 'テスト',
				activityName: '体操',
				totalPoints: 10,
				levelUp: null,
				unlockedAchievements: [],
			});
			expect(mockFindByTenant).not.toHaveBeenCalled();
		});

		it('レベルアップ時はレベルアップ通知', async () => {
			process.env.AUTH_MODE = 'local';
			await sendAchievementNotification('T1', {
				childName: 'テスト',
				activityName: '体操',
				totalPoints: 10,
				levelUp: { newLevel: 5 },
				unlockedAchievements: [],
			});
			expect(mockInsertLog).toHaveBeenCalledWith(
				expect.objectContaining({ notificationType: 'level_up', title: 'レベルアップ！' }),
			);
		});

		it('通常記録時は達成通知', async () => {
			process.env.AUTH_MODE = 'local';
			await sendAchievementNotification('T1', {
				childName: 'テスト',
				activityName: '体操',
				totalPoints: 10,
				levelUp: null,
				unlockedAchievements: [],
			});
			expect(mockInsertLog).toHaveBeenCalledWith(
				expect.objectContaining({ notificationType: 'achievement', title: 'きろく完了！' }),
			);
		});
	});
});
