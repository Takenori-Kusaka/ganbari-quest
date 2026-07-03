// tests/unit/services/notification-service-vapid-distribution.test.ts
// #2191 AC5: VAPID 鍵配布証跡 (ADR-0006 整合) + 4 系統 (reminder/streak/achievement/level_up) ユニット
//
// 既存 `notification-service.test.ts` 24 件は web-push を mock した発火経路を網羅するが、
// 本 spec は「VAPID env が配布されている前提」と「未配布時 silent fail」の 2 側面を
// 構造的に検証する。
//
// 設計意図:
//   - VAPID env が `.env.production` / SSM / GitHub Actions Secrets の 3 箇所に配布されていることは
//     CI で機械検証できないが、`docs/operations/notification-runbook.md` で配布手順 SSOT 化済。
//   - 本 spec は「未配布時に notification-service が crash せず warn + skip 動作になる」
//     こと自体を assertion し、将来 silent fail が暴発するリグレッションを検出する。

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

// Mock logger (vi.hoisted で vi.mock より先に評価される必要あり)
const { mockLoggerWarn, mockLoggerInfo } = vi.hoisted(() => ({
	mockLoggerWarn: vi.fn(),
	mockLoggerInfo: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: vi.fn(), debug: vi.fn() },
}));

import webpush from 'web-push';
import { countTodayLogs, findByTenant, insertLog } from '$lib/server/db/push-subscription-repo';
import { getSettings } from '$lib/server/db/settings-repo';
import {
	sendAchievementNotification,
	sendPushNotification,
} from '$lib/server/services/notification-service';

const mockFindByTenant = vi.mocked(findByTenant);
const mockInsertLog = vi.mocked(insertLog);
const mockCountTodayLogs = vi.mocked(countTodayLogs);
const mockGetSettings = vi.mocked(getSettings);
const mockSendNotification = vi.mocked(webpush.sendNotification);
const mockSetVapidDetails = vi.mocked(webpush.setVapidDetails);

describe('#2191 AC5 VAPID 配布証跡 — notification-service silent fail ガード', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		// production モード相当 (AUTH_MODE=cognito) で VAPID 配布前提を満たさない状況を構築
		process.env.AUTH_MODE = 'cognito';
		mockGetSettings.mockResolvedValue({});
		mockInsertLog.mockResolvedValue({
			id: 1,
			tenantId: 'T1',
			notificationType: 'test',
			title: 'test',
			body: 'test',
			sentAt: '2026-05-18T03:00:00.000Z',
			success: 1,
			errorMessage: null,
		});
		// 昼間 JST (12:00) でサイレント時間帯を回避
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-18T03:00:00Z'));
		mockCountTodayLogs.mockResolvedValue(0);
		mockFindByTenant.mockResolvedValue([
			{
				id: 1,
				tenantId: 'T1',
				endpoint: 'https://fcm.googleapis.com/fcm/send/x',
				keysP256dh: 'p',
				keysAuth: 'a',
				userAgent: null,
				subscriberRole: 'parent',
				createdAt: '',
			},
		]);
	});

	afterEach(() => {
		vi.useRealTimers();
		delete process.env.AUTH_MODE;
		delete process.env.VAPID_PUBLIC_KEY;
		delete process.env.VAPID_PRIVATE_KEY;
		delete process.env.VAPID_SUBJECT;
	});

	it('AC5-1: VAPID_PUBLIC_KEY 未配布なら silent fail + warn ログ', async () => {
		delete process.env.VAPID_PUBLIC_KEY;
		process.env.VAPID_PRIVATE_KEY = 'test-private';

		const result = await sendPushNotification('T1', 'reminder', 'タイトル', '本文');

		expect(result).toEqual({ sent: 0, failed: 0 });
		expect(mockSendNotification).not.toHaveBeenCalled();
		expect(mockSetVapidDetails).not.toHaveBeenCalled();
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			expect.stringContaining('VAPID キーが設定されていません'),
		);
	});

	it('AC5-2: VAPID_PRIVATE_KEY 未配布なら silent fail + warn ログ', async () => {
		process.env.VAPID_PUBLIC_KEY = 'test-public';
		delete process.env.VAPID_PRIVATE_KEY;

		const result = await sendPushNotification('T1', 'reminder', 'タイトル', '本文');

		expect(result).toEqual({ sent: 0, failed: 0 });
		expect(mockSendNotification).not.toHaveBeenCalled();
		expect(mockLoggerWarn).toHaveBeenCalled();
	});

	it('AC5-3: VAPID 両方配布されていれば webpush.setVapidDetails が呼ばれる', async () => {
		process.env.VAPID_PUBLIC_KEY = 'test-public-key-distributed';
		process.env.VAPID_PRIVATE_KEY = 'test-private-key-distributed';
		process.env.VAPID_SUBJECT = 'mailto:noreply@ganbari-quest.com';
		mockSendNotification.mockResolvedValue({} as never);

		const result = await sendPushNotification('T1', 'reminder', 'タイトル', '本文');

		expect(result.sent).toBe(1);
		expect(mockSetVapidDetails).toHaveBeenCalledWith(
			'mailto:noreply@ganbari-quest.com',
			'test-public-key-distributed',
			'test-private-key-distributed',
		);
	});

	it('AC5-4: VAPID_SUBJECT 未設定なら fallback デフォルト値 (mailto:noreply@ganbari-quest.com)', async () => {
		process.env.VAPID_PUBLIC_KEY = 'pk';
		process.env.VAPID_PRIVATE_KEY = 'sk';
		delete process.env.VAPID_SUBJECT;
		mockSendNotification.mockResolvedValue({} as never);

		await sendPushNotification('T1', 'reminder', 'タイトル', '本文');

		expect(mockSetVapidDetails).toHaveBeenCalledWith(
			'mailto:noreply@ganbari-quest.com', // notification-service.ts:61 のデフォルト値
			'pk',
			'sk',
		);
	});
});

describe('#2191 AC5 4 通知系統 — type 別 sendPushNotification 発火', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		process.env.AUTH_MODE = 'cognito';
		process.env.VAPID_PUBLIC_KEY = 'test-pk';
		process.env.VAPID_PRIVATE_KEY = 'test-sk';
		mockGetSettings.mockResolvedValue({});
		mockInsertLog.mockResolvedValue({
			id: 1,
			tenantId: 'T1',
			notificationType: 'test',
			title: 'test',
			body: 'test',
			sentAt: '2026-05-18T03:00:00.000Z',
			success: 1,
			errorMessage: null,
		});
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-18T03:00:00Z'));
		mockCountTodayLogs.mockResolvedValue(0);
		mockFindByTenant.mockResolvedValue([
			{
				id: 1,
				tenantId: 'T1',
				endpoint: 'https://fcm.googleapis.com/fcm/send/x',
				keysP256dh: 'p',
				keysAuth: 'a',
				userAgent: null,
				subscriberRole: 'parent',
				createdAt: '',
			},
		]);
		mockSendNotification.mockResolvedValue({} as never);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('系統 1: reminder type で送信される', async () => {
		await sendPushNotification('T1', 'reminder', 'きょうもがんばろう', '今日の活動を記録しよう');
		expect(mockSendNotification).toHaveBeenCalledTimes(1);
		const payload = JSON.parse((mockSendNotification.mock.calls[0]?.[1] as string) ?? '{}');
		expect(payload.data.type).toBe('reminder');
	});

	it('系統 2: streak_warning type で送信される', async () => {
		await sendPushNotification(
			'T1',
			'streak_warning',
			'連続記録が途切れそう',
			'今日まだ記録がないよ！',
		);
		expect(mockSendNotification).toHaveBeenCalledTimes(1);
		const payload = JSON.parse((mockSendNotification.mock.calls[0]?.[1] as string) ?? '{}');
		expect(payload.data.type).toBe('streak_warning');
	});

	it('系統 3: achievement type を sendAchievementNotification 経由で送信', async () => {
		await sendAchievementNotification('T1', {
			childName: 'たろう',
			activityName: 'うんどう',
			totalPoints: 50,
			levelUp: null,
			unlockedAchievements: [],
		});
		expect(mockSendNotification).toHaveBeenCalledTimes(1);
		const payload = JSON.parse((mockSendNotification.mock.calls[0]?.[1] as string) ?? '{}');
		expect(payload.data.type).toBe('achievement');
		expect(payload.title).toBe('きろく完了！');
	});

	it('系統 4: level_up type を sendAchievementNotification 経由で送信', async () => {
		await sendAchievementNotification('T1', {
			childName: 'たろう',
			activityName: 'べんきょう',
			totalPoints: 200,
			levelUp: { newLevel: 5 },
			unlockedAchievements: [],
		});
		expect(mockSendNotification).toHaveBeenCalledTimes(1);
		const payload = JSON.parse((mockSendNotification.mock.calls[0]?.[1] as string) ?? '{}');
		expect(payload.data.type).toBe('level_up');
		expect(payload.title).toBe('レベルアップ！');
		expect(payload.body).toContain('レベル5');
	});
});
