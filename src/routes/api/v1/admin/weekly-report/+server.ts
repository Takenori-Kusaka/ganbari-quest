// src/routes/api/v1/admin/weekly-report/+server.ts
// 週次活動レポートメール送信（EventBridge / 手動トリガー用）

import { json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import type { WeeklyReportData } from '$lib/server/services/email-service';
import { sendWeeklyReportEmail } from '$lib/server/services/email-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	// 内部 cron 認証（CRON_SECRET ヘッダ）
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
			ownerEmail: string;
			children: WeeklyReportData[];
		};

		let sent = 0;
		for (const child of body.children) {
			const ok = await sendWeeklyReportEmail(body.ownerEmail, child);
			if (ok) sent++;
		}

		logger.info('[weekly-report] レポート送信完了', {
			context: { tenantId: body.tenantId, sent, total: body.children.length },
		});

		return json({ success: true, sent, total: body.children.length });
	} catch (err) {
		logger.error('[weekly-report] レポート送信失敗', { error: String(err) });
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
