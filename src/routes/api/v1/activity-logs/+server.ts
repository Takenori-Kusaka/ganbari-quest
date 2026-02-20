import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	recordActivity,
	getActivityLogs,
} from '$lib/server/services/activity-log-service';
import {
	recordActivitySchema,
	activityLogsQuerySchema,
} from '$lib/domain/validation/activity';
import { apiError, validationError } from '$lib/server/errors';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const parsed = recordActivitySchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	const result = recordActivity(parsed.data.childId, parsed.data.activityId);

	if ('error' in result) {
		if (result.error === 'ALREADY_RECORDED') {
			return apiError('ALREADY_RECORDED', 'きょうはもうやったよ！');
		}
		if (result.error === 'NOT_FOUND') {
			return apiError('NOT_FOUND', `${result.target === 'child' ? 'こども' : 'かつどう'}がみつかりません`);
		}
	}

	return json(result, { status: 201 });
};

export const GET: RequestHandler = async ({ url }) => {
	const parsed = activityLogsQuerySchema.safeParse(
		Object.fromEntries(url.searchParams),
	);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	const { childId, period, from, to } = parsed.data;

	// Calculate date range from period if from/to not specified
	let dateFrom = from;
	let dateTo = to;

	if (!dateFrom) {
		const now = new Date();
		switch (period) {
			case 'week': {
				const d = new Date(now);
				d.setDate(d.getDate() - d.getDay()); // Start of week (Sunday)
				dateFrom = d.toISOString().slice(0, 10);
				break;
			}
			case 'month': {
				dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
				break;
			}
			case 'year': {
				dateFrom = `${now.getFullYear()}-01-01`;
				break;
			}
		}
	}

	const result = getActivityLogs(childId, { from: dateFrom, to: dateTo });
	return json(result);
};
