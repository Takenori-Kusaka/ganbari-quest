// src/routes/api/v1/admin/weekly-report/+server.ts
// 週次活動レポートメール送信（EventBridge / 手動トリガー用）
//
// #735: 週次メールレポートはスタンダードプラン以上の特典。
// /pricing の features で「週次メールレポート」と明示しているにもかかわらず、
// 旧実装は全テナント（無料プラン含む）に配信しており、
//   - 課金動機を削ぐ（有料プラン特典の価値毀損）
//   - SES 送信コストが想定比率を超過する
//   - HP と実装の乖離で課金ユーザーが不公平感を持つ
// という三重の問題があった。本エンドポイントでプラン解決→free は早期 return する。

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import type { WeeklyReportData } from '$lib/server/services/email-service';
import { sendWeeklyReportEmail } from '$lib/server/services/email-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	try {
		const body = (await request.json()) as {
			tenantId: string;
			ownerEmail: string;
			children: WeeklyReportData[];
		};

		// #735: プランゲート — 無料プランは送信スキップ
		// licenseInfo が取得できない場合は安全側に倒してスキップ（未知のテナントには送らない）
		const licenseInfo = await getLicenseInfo(body.tenantId);
		if (!licenseInfo) {
			logger.warn('[weekly-report] テナント情報が見つからないため送信スキップ', {
				context: { tenantId: body.tenantId },
			});
			return json({
				success: true,
				sent: 0,
				total: body.children.length,
				skipped: 'tenant_not_found',
			});
		}

		const planTier = await resolveFullPlanTier(body.tenantId, licenseInfo.status, licenseInfo.plan);

		if (planTier === 'free') {
			logger.info('[weekly-report] 無料プランのため送信スキップ', {
				context: { tenantId: body.tenantId, total: body.children.length },
			});
			return json({ success: true, sent: 0, total: body.children.length, skipped: 'free_plan' });
		}

		let sent = 0;
		for (const child of body.children) {
			const ok = await sendWeeklyReportEmail(body.ownerEmail, child);
			if (ok) sent++;
		}

		logger.info('[weekly-report] レポート送信完了', {
			context: { tenantId: body.tenantId, planTier, sent, total: body.children.length },
		});

		return json({ success: true, sent, total: body.children.length, planTier });
	} catch (err) {
		logger.error('[weekly-report] レポート送信失敗', { error: String(err) });
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
