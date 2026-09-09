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
	// #4867 系 QM 監査 (S2) / PO 決裁 2026-09-09: **親だけが触ってよい経路**。
	//
	// `/api/v1/**` は `authorization.ts` の ROUTE_RULES が `['owner','parent','child']` に
	// 開けている (既存 test が固定している仕様)。つまり **child セッションはここに到達できる**
	// ので、「ここは親だけ」は各 route が言う以外にない。無いと子供が親の設定を書き換えられ、
	// **親が決め、子が記録する**という製品の中核が崩れる (ADR-0012 の前提)。
	//
	// **読み取り (GET) は閉じない** — 一覧を引けること自体は親限定と言い切れず、
	// PO 決裁が「判断が要るものは私へ」としているため。閉じるのは書き込みだけ。
	if (context.role !== 'owner' && context.role !== 'parent') {
		return forbiddenForNonParent();
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
	// #4867 系 QM 監査 (S2) / PO 決裁 2026-09-09: **親だけが触ってよい経路**。
	//
	// `/api/v1/**` は `authorization.ts` の ROUTE_RULES が `['owner','parent','child']` に
	// 開けている (既存 test が固定している仕様)。つまり **child セッションはここに到達できる**
	// ので、「ここは親だけ」は各 route が言う以外にない。無いと子供が親の設定を書き換えられ、
	// **親が決め、子が記録する**という製品の中核が崩れる (ADR-0012 の前提)。
	//
	// **読み取り (GET) は閉じない** — 一覧を引けること自体は親限定と言い切れず、
	// PO 決裁が「判断が要るものは私へ」としているため。閉じるのは書き込みだけ。
	if (context.role !== 'owner' && context.role !== 'parent') {
		return forbiddenForNonParent();
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
