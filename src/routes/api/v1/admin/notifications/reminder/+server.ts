// src/routes/api/v1/admin/notifications/reminder/+server.ts
// リマインダー通知 — EventBridge / 手動トリガー用

import { json } from '@sveltejs/kit';
import { formatChildNames } from '$lib/domain/child-display';
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
			children: { name: string }[];
		};

		const settings = await getNotificationSettings(body.tenantId);
		if (!settings.remindersEnabled) {
			return json({ success: true, sent: 0, reason: 'disabled' });
		}

		const nameLabel = formatChildNames(
			body.children.map((c) => c.name),
			'possessive',
		);
		if (!nameLabel) {
			return json({ success: true, sent: 0, reason: 'no_children' });
		}
		const result = await sendPushNotification(
			body.tenantId,
			'reminder',
			'きょうも がんばろう！',
			`${nameLabel}がんばりを きろくしよう！`,
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
