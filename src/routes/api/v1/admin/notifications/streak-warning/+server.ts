// src/routes/api/v1/admin/notifications/streak-warning/+server.ts
// ストリーク警告通知 — EventBridge / 手動トリガー用

import { json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import {
	getNotificationSettings,
	sendPushNotification,
} from '$lib/server/services/notification-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	// 内部 cron 認証
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret) {
		const authHeader = request.headers.get('x-cron-secret');
		if (authHeader !== cronSecret) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
	} else if (process.env.AUTH_MODE !== 'local') {
		return json({ error: 'CRON_SECRET not configured' }, { status: 500 });
	}

	try {
		const body = (await request.json()) as {
			tenantId: string;
			children: { name: string; streakDays: number; hasRecordedToday: boolean }[];
		};

		const settings = await getNotificationSettings(body.tenantId);
		if (!settings.streakEnabled) {
			return json({ success: true, sent: 0, reason: 'disabled' });
		}

		// ストリーク中かつ今日未記録の子供だけ対象
		const atRisk = body.children.filter((c) => c.streakDays > 0 && !c.hasRecordedToday);
		if (atRisk.length === 0) {
			return json({ success: true, sent: 0, reason: 'no_at_risk' });
		}

		let totalSent = 0;
		let totalFailed = 0;

		for (const child of atRisk) {
			const result = await sendPushNotification(
				body.tenantId,
				'streak_warning',
				'ストリークが あぶない！',
				`${child.name}の ${child.streakDays}日れんぞくが きょうでとぎれちゃうよ！ いまからがんばろう！`,
				{ type: 'streak_warning' },
			);
			totalSent += result.sent;
			totalFailed += result.failed;
		}

		logger.info('[notification/streak-warning] ストリーク警告送信完了', {
			context: { tenantId: body.tenantId, atRisk: atRisk.length, totalSent },
		});

		return json({ success: true, sent: totalSent, failed: totalFailed });
	} catch (err) {
		logger.error('[notification/streak-warning] 送信失敗', { error: String(err) });
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
