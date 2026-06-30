// src/lib/server/services/notification-service.ts
// Web Push 通知サービス — VAPID + web-push ライブラリ
// ローカルモード (AUTH_MODE=local) ではログ出力のみ

import webpush from 'web-push';
import { formatChildName } from '$lib/domain/child-display';
import { todayDateJST } from '$lib/domain/date-utils';
import {
	countTodayLogs,
	deleteByEndpoint,
	findByTenant,
	insertLog,
} from '$lib/server/db/push-subscription-repo';
import { getSettings } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import {
	isDefinitelyMaliciousEndpoint,
	validatePushEndpoint,
} from '$lib/server/services/push-endpoint-validation';

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

/**
 * 確定 SSRF endpoint (`isDefinitelyMaliciousEndpoint` true のもの) のみを DB から cleanup 削除する。
 * 各削除を try/catch で隔離し、DB 例外が呼び出し元の有効 subscriber 配信を巻き込まないようにする
 * (削除失敗は warn + 続行)。allowlist 網羅漏れ (https の未知ベンダー host) は呼び出し側で除外済で、
 * ここには渡されない (正規購読を恒久喪失させないため、#3455)。
 */
async function cleanupMaliciousEndpoints(
	endpoints: readonly string[],
	tenantId: string,
): Promise<void> {
	for (const endpoint of endpoints) {
		try {
			await deleteByEndpoint(endpoint, tenantId);
		} catch (err) {
			logger.warn('[notification] 確定 SSRF endpoint の cleanup 削除に失敗 (配信は継続)', {
				context: { tenantId, endpoint, error: String(err) },
			});
		}
	}
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
	const today = todayDateJST();
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
	const allSubscriptions = await findByTenant(tenantId);
	if (allSubscriptions.length === 0) {
		return { sent: 0, failed: 0 };
	}

	// #1593 (ADR-0023 I6): 二重防御 — child / 不明 role の subscription への送信を構造的に禁止。
	// subscribe API でも拒否しているが、過去レコード混入や将来 bug に備え送信側でもガード。
	const subscriptions = allSubscriptions.filter((sub) => {
		if (sub.subscriberRole === 'parent' || sub.subscriberRole === 'owner') {
			return true;
		}
		logger.warn('[notification] 非 parent/owner role の subscription への送信をスキップ', {
			context: {
				tenantId,
				endpoint: sub.endpoint,
				subscriberRole: sub.subscriberRole,
				notificationType,
			},
		});
		return false;
	});
	if (subscriptions.length === 0) {
		// 全 subscription が child role 等で skip された場合
		return { sent: 0, failed: 0 };
	}

	// #3404 (#3188 follow-up): 送信直前にも endpoint host を再検証する SSRF defense-in-depth。
	// subscribe API (#3188) で検証済だが、過去レコード混入 / repo 直 insert / 将来 bulk import 経路で
	// allowlist 外 endpoint が DB に入ると、send (webpush.sendNotification) が実際の HTTP request を
	// 出す sink となり SSRF (CWE-918) が成立する。送信側でも allowlist 外を skip して single-point を塞ぐ。
	const skippedEndpoints: string[] = []; // allowlist 外で送信 skip した全 endpoint (証跡用)
	const maliciousEndpoints: string[] = []; // うち確定 SSRF (削除して安全なもの) のみ
	const validSubscriptions = subscriptions.filter((sub) => {
		if (validatePushEndpoint(sub.endpoint).ok) return true;
		skippedEndpoints.push(sub.endpoint);
		const malicious = isDefinitelyMaliciousEndpoint(sub.endpoint);
		if (malicious) maliciousEndpoints.push(sub.endpoint);
		logger.warn('[notification] allowlist 外 endpoint への送信を skip (SSRF defense-in-depth)', {
			context: { tenantId, endpoint: sub.endpoint, notificationType, willDelete: malicious },
		});
		return false;
	});

	// #3421 item3 (#3455 BLOCK 是正): cleanup は **確定 SSRF (非 https / private・loopback・
	// link-local metadata IP)** に限定して削除する。allowlist は静的ハードコードで「動く標的」であり、
	// ベンダーが push host を新設/移行すると正規 subscription が allowlist-miss に落ちる。これを一律削除
	// すると、その host の正規購読を**恒久喪失** (allowlist 追記で可逆回復できるのに不可逆破壊) させる。
	// よって allowlist 網羅漏れ (https + 未知だが plausible なベンダー host) は削除せず skip + warn に留め、
	// 確定 SSRF のみ stale 410/404 と対称化して削除する (再購読 UI が揃うまで保守的)。
	// delete は try/catch で隔離し、DB 例外が下の有効 subscriber 配信を巻き込まない (失敗は warn + 続行)。
	await cleanupMaliciousEndpoints(maliciousEndpoints, tenantId);

	if (validSubscriptions.length === 0) {
		// #3421 item2: 0 件 skip も証跡を残す (insertLog を通さない early return は notification_logs に
		// 記録ゼロ = 通知 silent 全消失を運用が追跡不能になるため)。
		await insertLog({
			tenantId,
			notificationType,
			title,
			body,
			success: false,
			errorMessage:
				skippedEndpoints.length > 0
					? `all ${skippedEndpoints.length} subscription(s) skipped by SSRF allowlist`
					: 'no valid subscriptions to send',
		});
		return { sent: 0, failed: 0 };
	}

	const payload = JSON.stringify({ title, body, data: { ...data, type: notificationType } });
	let sent = 0;
	let failed = 0;

	for (const sub of validSubscriptions) {
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
			`${formatChildName(data.childName, 'subject')} レベル${data.levelUp.newLevel}に なったよ！ すごい！`,
			{ type: 'level_up' },
		);
	} else {
		await sendPushNotification(
			tenantId,
			'achievement',
			'きろく完了！',
			`${formatChildName(data.childName, 'subject')}「${data.activityName}」を がんばったよ！ +${data.totalPoints}P`,
			{ type: 'achievement' },
		);
	}
}
