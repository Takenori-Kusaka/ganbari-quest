// src/routes/api/v1/children/[id]/activities/[activityId]/pin/+server.ts
// 活動ピン留めトグルAPI

import { json } from '@sveltejs/kit';
import { asActivityId, asChildId } from '$lib/domain/ids';
import { apiError } from '$lib/server/errors';
import { ActivityPinError, toggleActivityPin } from '$lib/server/services/activity-pin-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.id);
	const activityId = asActivityId(params.activityId);

	if (!childId || !activityId) {
		return apiError('VALIDATION_ERROR', '不正なIDです');
	}

	let pinned = true;
	try {
		const body = await request.json();
		pinned = body.pinned !== false;
	} catch {
		// body なしの場合はピン留めとして扱う
	}

	try {
		const result = await toggleActivityPin(childId, activityId, pinned, tenantId);
		return json(result);
	} catch (err) {
		// #4716 / ADR-0062: 拒否理由 (ActivityPinError) のみ返し、想定外例外の内部 message は返さない。
		if (err instanceof ActivityPinError) {
			return apiError('VALIDATION_ERROR', err.message);
		}
		// #4716 (QM): 想定外例外を VALIDATION_ERROR に畳むと、DB 障害が「入力内容に問題があります」
		// という 400 になり、顧客には誤った原因が出て運用側は warn 1 行しか残らない。
		// 種別 (顧客の入力ミス / システム障害) を取り違えないよう INTERNAL_ERROR (500) に倒す。
		return apiError('INTERNAL_ERROR', 'ピン留めに失敗しました', {
			childId,
			activityId,
			cause: err instanceof Error ? err.message : String(err),
		});
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.id);
	const activityId = asActivityId(params.activityId);

	if (!childId || !activityId) {
		return apiError('VALIDATION_ERROR', '不正なIDです');
	}

	try {
		const result = await toggleActivityPin(childId, activityId, false, tenantId);
		return json(result);
	} catch (err) {
		if (err instanceof ActivityPinError) {
			return apiError('VALIDATION_ERROR', err.message);
		}
		// POST 側と同じ理由で、想定外例外は 400 ではなく INTERNAL_ERROR (500) に倒す。
		return apiError('INTERNAL_ERROR', 'ピン留め解除に失敗しました', {
			childId,
			activityId,
			cause: err instanceof Error ? err.message : String(err),
		});
	}
};
