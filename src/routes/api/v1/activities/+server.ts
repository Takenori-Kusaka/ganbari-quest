import { json } from '@sveltejs/kit';
// #3740: client-facing 経路の wire source は信頼せず正準 'custom' を強制する (trust 境界分離)
import { PARENT_CREATED_SOURCE } from '$lib/domain/activity-source';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { activitiesQuerySchema, createActivitySchema } from '$lib/domain/validation/activity';
import { findChildById } from '$lib/server/db/activity-repo';
import { apiError, validationError } from '$lib/server/errors';
import { createActivity, getActivities } from '$lib/server/services/activity-service';
import { checkActivityLimit } from '$lib/server/services/plan-limit-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const parsed = activitiesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	let childAge: number | undefined;
	if (parsed.data.childId) {
		const child = await findChildById(parsed.data.childId, tenantId);
		if (child) childAge = child.age;
	}

	const result = await getActivities(tenantId, {
		childAge,
		categoryId: parsed.data.categoryId,
		includeHidden: parsed.data.includeHidden,
	});

	return json({ activities: result });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();
	const parsed = createActivitySchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	// #3740: 親手動作成経路 (admin `create` action と同型) の quota gate。gate 未通過だと
	// free tier (maxActivities=3) が raw API 反復で上限を無制限に回避できる (課金境界執行)。
	const licenseStatus = context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const limitCheck = await checkActivityLimit(tenantId, licenseStatus);
	if (!limitCheck.allowed) {
		return apiError(
			'PLAN_LIMIT_EXCEEDED',
			`カスタム活動は最大${limitCheck.max}個まで作成できます。プランをアップグレードしてください。`,
			{ current: limitCheck.current, max: limitCheck.max },
		);
	}

	// #3740: wire `source` ('seed'/'curriculum' 含む) を信頼すると quota 集計対象外の値を
	// 注入して上限を回避できるため、client-facing 経路では正準 'custom' を強制する。
	// seed / curriculum を指定できるのは内部 caller (seed.ts / import-service) のみ (trust 境界分離)。
	const activity = await createActivity(
		{ ...parsed.data, source: PARENT_CREATED_SOURCE },
		tenantId,
	);
	return json(activity, { status: 201 });
};
