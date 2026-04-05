// src/lib/server/services/notification-service.ts
// Web Push 通知サービス — VAPID + web-push ライブラリ
// ローカルモード (AUTH_MODE=local) ではログ出力のみ

import webpush from 'web-push';
import {
	countTodayLogs,
	deleteByEndpoint,
	findByTenant,
	insertLog,
} from '$lib/server/db/push-subscription-repo';
import { getSettings } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';

// ============================================================
// 型定義
// ============================================================

export interface NotificationSettings {
	remindersEnabled: boolean;
	reminderTime: string; // HH:MM
	streakEnabled: boolean;
	achievementsEnabled: boolean;
	quietStart: string; // HH:MM
	quietEnd: string; // HH:MM
}

export interface SendResult {
	sent: number;
	failed: number;
}

interface AchievementNotificationData {
	childName: string;
	activityName: string;
	totalPoints: number;
	levelUp: { newLevel: number } | null;
	unlockedAchievements: { name: string }[];
}

// ============================================================
// 定数
// ============================================================

const MAX_DAILY_NOTIFICATIONS = 3;

// ============================================================
// ヘルパー
// ============================================================

function isLocalMode(): boolean {
	return (process.env.AUTH_MODE ?? 'local') === 'local';
}

function getVapidKeys(): { publicKey: string; privateKey: string; subject: string } {
	return {
		publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
		privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
		subject: process.env.VAPID_SUBJECT ?? 'mailto:noreply@ganbari-quest.com',
	};
}

// ============================================================
// 設定読み取り
// ============================================================

export async function getNotificationSettings(tenantId: string): Promise<NotificationSettings> {
	const values = await getSettings(
		[
			'notification_reminders_enabled',
			'notification_reminder_time',
			'notification_streak_enabled',
			'notification_achievements_enabled',
			'notification_quiet_start',
			'notification_quiet_end',
		],
		tenantId,
	);
	return {
		remindersEnabled: values.notification_reminders_enabled !== 'false',
		reminderTime: values.notification_reminder_time ?? '09:00',
		streakEnabled: values.notification_streak_enabled !== 'false',
		achievementsEnabled: values.notification_achievements_enabled !== 'false',
		quietStart: values.notification_quiet_start ?? '21:00',
		quietEnd: values.notification_quiet_end ?? '07:00',
	};
}

// ============================================================
// サイレント時間帯チェック
// ============================================================

/** 現在がサイレント時間帯かチェック (JST基準、ラップアラウンド対応) */
export function isQuietHours(now?: Date, quietStart = '21:00', quietEnd = '07:00'): boolean {
	const date = now ?? new Date();
	// JST = UTC+9
	const jstHour = (date.getUTCHours() + 9) % 24;
	const jstMinute = date.getUTCMinutes();
	const currentMinutes = jstHour * 60 + jstMinute;

	const startParts = quietStart.split(':').map(Number);
	const endParts = quietEnd.split(':').map(Number);
	const startMinutes = (startParts[0] ?? 21) * 60 + (startParts[1] ?? 0);
	const endMinutes = (endParts[0] ?? 7) * 60 + (endParts[1] ?? 0);

	// ラップアラウンド: 21:00 - 07:00
	if (startMinutes > endMinutes) {
		return currentMinutes >= startMinutes || currentMinutes < endMinutes;
	}
	// 通常: 09:00 - 17:00
	return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

// ============================================================
// レート制限チェック
// ============================================================

export async function canSendNotification(tenantId: string): Promise<boolean> {
	const settings = await getNotificationSettings(tenantId);

	// サイレント時間帯チェック
	if (isQuietHours(undefined, settings.quietStart, settings.quietEnd)) {
		return false;
	}

	// 日次上限チェック
	const today = new Date().toISOString().slice(0, 10);
	const count = await countTodayLogs(tenantId, today);
	return count < MAX_DAILY_NOTIFICATIONS;
}

// ============================================================
// コア送信
// ============================================================

export async function sendPushNotification(
	tenantId: string,
	notificationType: string,
	title: string,
	body: string,
	data?: Record<string, unknown>,
): Promise<SendResult> {
	// ローカルモード: ログ出力のみ
	if (isLocalMode()) {
		logger.info('[notification] ローカルモード: プッシュ通知スキップ', {
			context: { tenantId, notificationType, title, body },
		});
		await insertLog({
			tenantId,
			notificationType,
			title,
			body,
			success: true,
		});
		return { sent: 1, failed: 0 };
	}

	// レート制限チェック
	const allowed = await canSendNotification(tenantId);
	if (!allowed) {
		logger.info('[notification] レート制限またはサイレント時間帯のためスキップ', {
			context: { tenantId, notificationType },
		});
		return { sent: 0, failed: 0 };
	}

	// VAPID 設定
	const vapid = getVapidKeys();
	if (!vapid.publicKey || !vapid.privateKey) {
		logger.warn('[notification] VAPID キーが設定されていません');
		return { sent: 0, failed: 0 };
	}
	webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

	// テナントの全購読を取得
	const subscriptions = await findByTenant(tenantId);
	if (subscriptions.length === 0) {
		return { sent: 0, failed: 0 };
	}

	const payload = JSON.stringify({ title, body, data: { ...data, type: notificationType } });
	let sent = 0;
	let failed = 0;

	for (const sub of subscriptions) {
		try {
			await webpush.sendNotification(
				{
					endpoint: sub.endpoint,
					keys: { p256dh: sub.keysP256dh, auth: sub.keysAuth },
				},
				payload,
			);
			sent++;
		} catch (err: unknown) {
			const statusCode = (err as { statusCode?: number })?.statusCode;
			// 410 Gone or 404 = stale subscription → 自動削除
			if (statusCode === 410 || statusCode === 404) {
				logger.info('[notification] stale subscription を削除', {
					context: { endpoint: sub.endpoint },
				});
				await deleteByEndpoint(sub.endpoint, tenantId);
			} else {
				logger.error('[notification] プッシュ通知送信失敗', {
					context: { endpoint: sub.endpoint, error: String(err) },
				});
			}
			failed++;
		}
	}

	// ログ記録
	await insertLog({
		tenantId,
		notificationType,
		title,
		body,
		success: sent > 0,
		errorMessage: failed > 0 ? `${failed} subscription(s) failed` : null,
	});

	return { sent, failed };
}

// ============================================================
// 達成通知ヘルパー（activity-log-service から呼ばれる）
// ============================================================

export async function sendAchievementNotification(
	tenantId: string,
	data: AchievementNotificationData,
): Promise<void> {
	const settings = await getNotificationSettings(tenantId);
	if (!settings.achievementsEnabled) return;

	if (data.levelUp) {
		await sendPushNotification(
			tenantId,
			'level_up',
			'レベルアップ！',
			`${data.childName}が レベル${data.levelUp.newLevel}に なったよ！ すごい！`,
			{ type: 'level_up' },
		);
	} else {
		await sendPushNotification(
			tenantId,
			'achievement',
			'きろく完了！',
			`${data.childName}が「${data.activityName}」を がんばったよ！ +${data.totalPoints}P`,
			{ type: 'achievement' },
		);
	}
}
