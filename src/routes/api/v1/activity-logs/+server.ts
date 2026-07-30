import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import {
	addDaysJST,
	jstDayOfWeek,
	jstYearMonth,
	monthStartJST,
	todayDateJST,
	weekStartJST,
} from '$lib/domain/date-utils';
import { activityLogsQuerySchema, recordActivitySchema } from '$lib/domain/validation/activity';
import { apiError, validationError } from '$lib/server/errors';
import { getActivityLogs, recordActivity } from '$lib/server/services/activity-log-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();
	const parsed = v.safeParse(recordActivitySchema, body);
	if (!parsed.success) {
		return validationError(parsed.issues[0]?.message ?? '入力が不正です');
	}

	const result = await recordActivity(parsed.output.childId, parsed.output.activityId, tenantId);

	if ('error' in result) {
		if (result.error === 'ALREADY_RECORDED') {
			return apiError('ALREADY_RECORDED', 'きょうはもうやったよ！');
		}
		if (result.error === 'NOT_FOUND') {
			return apiError(
				'NOT_FOUND',
				`${result.target === 'child' ? 'こども' : 'かつどう'}がみつかりません`,
			);
		}
	}

	return json(result, { status: 201 });
};

export const GET: RequestHandler = async ({ url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const parsed = v.safeParse(activityLogsQuerySchema, Object.fromEntries(url.searchParams));
	if (!parsed.success) {
		return validationError(parsed.issues[0]?.message ?? 'パラメータが不正です');
	}

	const { childId, period, from, to } = parsed.output;

	// Calculate date range from period if from/to not specified
	let dateFrom = from;
	const dateTo = to;

	if (!dateFrom) {
		// 期間の起点は JST SSOT 経由 (#4015)。旧実装は「ローカル TZ の曜日で週頭を決めて
		// UTC 文字列化」という #4003 と同型の混在で、JST 00:00〜09:00 に 1 日ずれていた。
		switch (period) {
			case 'week': {
				// 週の起点は日曜 (本 API の既存仕様)。weekStartJST() は月曜始まりのため 1 日戻す。
				const monday = weekStartJST();
				dateFrom = jstDayOfWeek() === 0 ? todayDateJST() : addDaysJST(monday, -1);
				break;
			}
			case 'month': {
				dateFrom = monthStartJST();
				break;
			}
			case 'year': {
				dateFrom = `${jstYearMonth().year}-01-01`;
				break;
			}
		}
	}

	const result = await getActivityLogs(childId, tenantId, { from: dateFrom, to: dateTo });
	return json(result);
};
