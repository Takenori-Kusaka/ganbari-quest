// src/routes/api/v1/admin/notifications/reminder/+server.ts
// リマインダー通知 — EventBridge / 手動トリガー用

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
			children: { name: string }[];
		};

		const settings = await getNotificationSettings(body.tenantId);
		if (!settings.remindersEnabled) {
			return json({ success: true, sent: 0, reason: 'disabled' });
		}

		const childNames = body.children.map((c) => c.name).join('、');
		const result = await sendPushNotification(
			body.tenantId,
			'reminder',
			'きょうも がんばろう！',
			`${childNames}の がんばりを きろくしよう！`,
			{ type: 'reminder' },
		);

		logger.info('[notification/reminder] リマインダー送信完了', {
			context: { tenantId: body.tenantId, ...result },
		});

		return json({ success: true, ...result });
	} catch (err) {
		logger.error('[notification/reminder] 送信失敗', { error: String(err) });
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
