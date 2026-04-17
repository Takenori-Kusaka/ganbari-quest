// src/routes/api/v1/children/[id]/activities/[activityId]/pin/+server.ts
// 活動ピン留めトグルAPI

import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/errors';
import { toggleActivityPin } from '$lib/server/services/activity-pin-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = Number(params.id);
	const activityId = Number(params.activityId);

	if (Number.isNaN(childId) || Number.isNaN(activityId)) {
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
		const message = err instanceof Error ? err.message : 'ピン留めに失敗しました';
		return apiError('VALIDATION_ERROR', message);
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = Number(params.id);
	const activityId = Number(params.activityId);

	if (Number.isNaN(childId) || Number.isNaN(activityId)) {
		return apiError('VALIDATION_ERROR', '不正なIDです');
	}

	try {
		const result = await toggleActivityPin(childId, activityId, false, tenantId);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'ピン留め解除に失敗しました';
		return apiError('VALIDATION_ERROR', message);
	}
};
