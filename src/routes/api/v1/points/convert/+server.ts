import { json } from '@sveltejs/kit';
import { ConvertMode, convertPointsSchema } from '$lib/domain/validation/point';
import { apiError, validationError } from '$lib/server/errors';
import { convertPoints } from '$lib/server/services/point-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();
	// mode が未指定の場合はプリセットとして扱う（後方互換）
	const input = { mode: ConvertMode.PRESET, ...body };
	const parsed = convertPointsSchema.safeParse(input);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	const result = await convertPoints(
		parsed.data.childId,
		parsed.data.amount,
		tenantId,
		parsed.data.mode,
	);

	if ('error' in result) {
		if (result.error === 'NOT_FOUND') {
			return apiError('NOT_FOUND', 'こどもがみつかりません');
		}
		if (result.error === 'INSUFFICIENT_POINTS') {
			return apiError('INSUFFICIENT_POINTS', 'ポイントがたりません');
		}
	}

	return json(result);
};
