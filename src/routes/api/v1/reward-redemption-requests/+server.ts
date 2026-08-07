// src/routes/api/v1/reward-redemption-requests/+server.ts
// ごほうびショップ交換申請 API (#1337)
// POST: 子供が申請作成
// GET: 親が申請一覧取得

import { json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { CHILD_SHOP_LABELS } from '$lib/domain/labels';
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

	const rawRewardId = (body as Record<string, unknown> | null)?.rewardId;
	const rawChildId = (body as Record<string, unknown> | null)?.childId;
	// #3575: id は opaque string。旧クライアントの number も境界で受けて as* 変換する
	const isIdLike = (v: unknown): v is string | number =>
		(typeof v === 'string' && v !== '') || typeof v === 'number';
	if (
		typeof body !== 'object' ||
		body === null ||
		!isIdLike(rawRewardId) ||
		!isIdLike(rawChildId)
	) {
		return json({ error: 'rewardId と childId は必須です' }, { status: 400 });
	}

	const rewardId = String(rawRewardId);
	const childId = asChildId(rawChildId);
	// #4407: 個数。未指定は 1 個 (旧クライアント互換)。値域検証は service (domain 値域 SSOT) が行う。
	const rawQuantity = (body as Record<string, unknown>).quantity;
	const quantity = rawQuantity === undefined ? 1 : Number(rawQuantity);

	const result = await requestRedemption(childId, rewardId, tenantId, quantity);

	if ('error' in result) {
		// #4407: 新エラー種別を足しても「エラーを 201 で返す」抜けが起きないよう、
		// switch ではなく明示 map + 既定 400 で網羅する。
		const map: Record<string, { status: number; message: string }> = {
			INSUFFICIENT_POINTS: { status: 400, message: CHILD_SHOP_LABELS.errorInsufficientPoints },
			ALREADY_PENDING: { status: 409, message: CHILD_SHOP_LABELS.errorAlreadyPending },
			RECENTLY_EXCHANGED: { status: 409, message: CHILD_SHOP_LABELS.errorRecentlyExchanged },
			INVALID_QUANTITY: { status: 400, message: CHILD_SHOP_LABELS.errorInvalidQuantity },
			REWARD_NOT_FOUND: { status: 404, message: CHILD_SHOP_LABELS.errorRewardNotFound },
		};
		const mapped = map[result.error] ?? { status: 400, message: CHILD_SHOP_LABELS.errorGeneric };
		return json({ error: result.error, message: mapped.message }, { status: mapped.status });
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
	const childId = childIdStr ? asChildId(childIdStr) : undefined;
	const limitStr = url.searchParams.get('limit');
	const limit = limitStr ? Number(limitStr) : 50;

	const requests = await getRedemptionRequestsForParent(tenantId, { status, childId, limit });

	return json({ requests });
};
