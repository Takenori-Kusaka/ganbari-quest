// src/routes/api/v1/admin/tenant/cancel/+server.ts
// 解約申請（grace_period 開始）— owner 限定

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { notifyCancellation } from '$lib/server/services/discord-notify-service';
import { sendCancellationEmail } from '$lib/server/services/email-service';

const GRACE_PERIOD_DAYS = 30;

export const POST: RequestHandler = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const context = locals.context;

	if (!context || context.role !== 'owner') {
		return json({ error: 'owner のみ解約申請できます' }, { status: 403 });
	}

	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(tenantId);
	if (!tenant) {
		return json({ error: 'テナントが見つかりません' }, { status: 404 });
	}

	if (tenant.status === 'grace_period') {
		return json({ error: '既に解約手続き中です' }, { status: 409 });
	}
	if (tenant.status === 'terminated') {
		return json({ error: 'アカウントは既に削除済みです' }, { status: 409 });
	}

	// 猶予期間終了日を計算
	const graceEnd = new Date();
	graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);
	const graceEndAt = graceEnd.toISOString();

	await repos.auth.updateTenantStripe(tenantId, {
		status: 'grace_period',
		planExpiresAt: graceEndAt,
	});

	// 通知（非同期、エラーは握りつぶす）
	const graceEndDate = graceEnd.toLocaleDateString('ja-JP');
	const ownerEmail = locals.identity?.type === 'cognito' ? locals.identity.email : undefined;
	if (ownerEmail) {
		sendCancellationEmail(ownerEmail, graceEndDate).catch(() => {});
	}
	notifyCancellation(tenantId, graceEndDate).catch(() => {});

	logger.info('[tenant] 解約申請', {
		context: { tenantId, graceEndAt },
	});

	return json({ success: true, graceEndAt, graceEndDate });
};
