import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { asActivityId } from '$lib/domain/ids';
import { updateActivitySchema } from '$lib/domain/validation/activity';
import { forbiddenForNonParent, notFound, validationError } from '$lib/server/errors';
import {
	getActivityById,
	setActivityVisibility,
	updateActivity,
} from '$lib/server/services/activity-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	// #4867 系 QM 監査 (S2) / PO 決裁 2026-09-09: **親だけが触ってよい経路**。
	// `/api/v1/**` は `authorization.ts` の ROUTE_RULES が child まで通すので、role 検査は
	// この route の責務。無いと子供が親の設定を書き換えられる (ポイント経済が壊れる = ADR-0012
	// の前提が崩れる)。判定は `forbiddenForNonParent` に集約し、fitness test が漏れを見る。
	if (context.role !== 'owner' && context.role !== 'parent') {
		return forbiddenForNonParent();
	}

	// #4867 系 QM 監査 (S2) / PO 決裁 2026-09-09: **親だけが触ってよい経路**。
	// `/api/v1/**` は `authorization.ts` の ROUTE_RULES が child まで通すので、role 検査は
	// この route の責務。無いと子供が親の設定を書き換えられる (ポイント経済が壊れる = ADR-0012
	// の前提が崩れる)。判定は `forbiddenForNonParent` に集約し、fitness test が漏れを見る。
	if (context.role !== 'owner' && context.role !== 'parent') {
		return forbiddenForNonParent();
	}

	const tenantId = context.tenantId;
	const id = asActivityId(params.id);
	if (!id) return validationError('IDが不正です');

	const activity = await getActivityById(id, tenantId);
	if (!activity) return notFound('かつどうがみつかりません');

	return json(activity);
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const id = asActivityId(params.id);
	if (!id) return validationError('IDが不正です');

	const existing = await getActivityById(id, tenantId);
	if (!existing) return notFound('かつどうがみつかりません');

	const body = await request.json();
	const parsed = v.safeParse(updateActivitySchema, body);
	if (!parsed.success) {
		return validationError(parsed.issues[0]?.message ?? '入力が不正です');
	}

	const updated = await updateActivity(id, parsed.output, tenantId);
	return json(updated);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const id = asActivityId(params.id);
	if (!id) return validationError('IDが不正です');

	const existing = await getActivityById(id, tenantId);
	if (!existing) return notFound('かつどうがみつかりません');

	// Soft delete: set visibility to false
	await setActivityVisibility(id, false, tenantId);
	return json({ message: '非表示にしました' });
};
