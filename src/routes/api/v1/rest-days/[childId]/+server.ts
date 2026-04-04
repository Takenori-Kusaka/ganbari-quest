import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	countRestDaysInMonth,
	deleteRestDay,
	findRestDays,
	insertRestDay,
} from '$lib/server/db/evaluation-repo';
import type { RequestHandler } from './$types';

const REST_DAY_MONTHLY_LIMIT = 10;
const VALID_REASONS = ['sick', 'trip', 'rest'] as const;

/** おやすみ日一覧取得 (GET /api/v1/rest-days/:childId?month=2026-03) */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (!childId) throw error(400, 'Invalid childId');

	const month = url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
	const days = await findRestDays(childId, month, tenantId);
	const count = await countRestDaysInMonth(childId, month, tenantId);

	return json({ days, count, limit: REST_DAY_MONTHLY_LIMIT });
};

/** おやすみ日登録 (POST /api/v1/rest-days/:childId) */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (!childId) throw error(400, 'Invalid childId');

	const body = await request.json();
	const date = body.date as string;
	const reason = body.reason as string;

	if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw error(400, 'Invalid date format (YYYY-MM-DD)');
	}
	if (!VALID_REASONS.includes(reason as (typeof VALID_REASONS)[number])) {
		throw error(400, `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`);
	}

	const yearMonth = date.slice(0, 7);
	const currentCount = await countRestDaysInMonth(childId, yearMonth, tenantId);
	if (currentCount >= REST_DAY_MONTHLY_LIMIT) {
		throw error(400, `月のおやすみ上限（${REST_DAY_MONTHLY_LIMIT}日）に達しています`);
	}

	const result = await insertRestDay(childId, date, reason, tenantId);
	return json({ ok: true, restDay: result });
};

/** おやすみ日削除 (DELETE /api/v1/rest-days/:childId) */
export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (!childId) throw error(400, 'Invalid childId');

	const body = await request.json();
	const date = body.date as string;

	if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw error(400, 'Invalid date format (YYYY-MM-DD)');
	}

	await deleteRestDay(childId, date, tenantId);
	return json({ ok: true });
};
