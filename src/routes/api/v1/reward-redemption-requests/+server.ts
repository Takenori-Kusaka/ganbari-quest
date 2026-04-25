// src/routes/api/v1/reward-redemption-requests/+server.ts
// ごほうびショップ交換申請 API (#1337)
// POST: 子供が申請作成
// GET: 親が申請一覧取得

import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	getRedemptionRequestsForParent,
	requestRedemption,
} from '$lib/server/services/reward-redemption-service';
import type { RequestHandler } from './$types';

/** 子供が交換申請を作成 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = requireTenantId(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: '不正なリクエストです' }, { status: 400 });
	}

	if (
		typeof body !== 'object' ||
		body === null ||
		typeof (body as Record<string, unknown>).rewardId !== 'number' ||
		typeof (body as Record<string, unknown>).childId !== 'number'
	) {
		return json({ error: 'rewardId と childId は必須です' }, { status: 400 });
	}

	const { rewardId, childId } = body as { rewardId: number; childId: number };

	const result = await requestRedemption(childId, rewardId, tenantId);

	if ('error' in result) {
		switch (result.error) {
			case 'INSUFFICIENT_POINTS':
				return json({ error: 'INSUFFICIENT_POINTS', message: 'ポイントが足りません' }, { status: 400 });
			case 'ALREADY_PENDING':
				return json(
					{ error: 'ALREADY_PENDING', message: '既に申請中です' },
					{ status: 409 },
				);
			case 'REWARD_NOT_FOUND':
				return json(
					{ error: 'REWARD_NOT_FOUND', message: 'ごほうびが見つかりません' },
					{ status: 404 },
				);
		}
	}

	return json(result, { status: 201 });
};

/** 親が申請一覧を取得 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const role = context.role;
	if (role !== 'owner' && role !== 'parent') {
		return json({ error: '権限がありません' }, { status: 403 });
	}

	const tenantId = requireTenantId(locals);
	const status = url.searchParams.get('status') ?? undefined;
	const childIdStr = url.searchParams.get('childId');
	const childId = childIdStr ? Number(childIdStr) : undefined;
	const limitStr = url.searchParams.get('limit');
	const limit = limitStr ? Number(limitStr) : 50;

	const requests = await getRedemptionRequestsForParent(tenantId, { status, childId, limit });

	return json({ requests });
};
