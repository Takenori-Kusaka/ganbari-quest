// src/routes/api/v1/admin/notifications/streak-warning/+server.ts
// ストリーク警告通知 — EventBridge / 手動トリガー用

import { json } from '@sveltejs/kit';
import { formatChildName } from '$lib/domain/child-display';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import {
	getNotificationSettings,
	sendPushNotification,
} from '$lib/server/services/notification-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	verifyCronAuth(request);

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
				`${formatChildName(child.name, 'possessive')}${child.streakDays}日れんぞくが きょうでとぎれちゃうよ！ いまからがんばろう！`,
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
