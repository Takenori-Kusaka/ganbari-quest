// src/routes/api/v1/usage/+server.ts
// 使用時間ログ API (#1292)

import { json } from '@sveltejs/kit';
import { endUsageSession, startUsageSession } from '$lib/server/services/usage-log-service';
import type { RequestHandler } from './$types';

/** POST /api/v1/usage — セッション開始を記録 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const { tenantId } = context;

	const body = await request.json().catch(() => null);
	const childId = body?.childId as number | undefined;
	if (!childId || typeof childId !== 'number') {
		return json({ error: 'childId が必要です' }, { status: 400 });
	}

	const result = await startUsageSession(tenantId, childId);
	if (!result) {
		return json({ error: 'セッション開始に失敗しました' }, { status: 500 });
	}

	return json({ id: result.id }, { status: 201 });
};

/** PATCH /api/v1/usage — セッション終了を記録 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const { tenantId } = context;

	const body = await request.json().catch(() => null);
	const id = body?.id as number | undefined;
	if (!id || typeof id !== 'number') {
		return json({ error: 'id が必要です' }, { status: 400 });
	}

	const result = await endUsageSession(id, tenantId);
	if (!result) {
		return json({ error: 'セッション終了に失敗しました' }, { status: 500 });
	}

	return json({ durationSec: result.durationSec }, { status: 200 });
};
