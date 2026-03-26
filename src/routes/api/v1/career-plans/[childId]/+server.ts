import { createCareerPlanSchema, updateCareerPlanSchema } from '$lib/domain/validation/career';
import { requireTenantId } from '$lib/server/auth/factory';
import { findChildById } from '$lib/server/db/point-repo';
import {
	createCareerPlan,
	getActiveCareerPlan,
	updateCareerPlanWithPoints,
} from '$lib/server/services/career-service';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** GET /api/v1/career-plans/:childId — アクティブプラン取得 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (!Number.isInteger(childId) || childId <= 0) {
		throw error(400, { message: '不正な子供IDです' });
	}

	const child = await findChildById(childId, tenantId);
	if (!child) throw error(404, { message: '子供が見つかりません' });

	const plan = await getActiveCareerPlan(childId, tenantId);

	if (!plan) {
		return json({ plan: null });
	}

	return json({
		plan: {
			...plan,
			mandalaChart: JSON.parse(plan.mandalaChart),
			targetStatuses: JSON.parse(plan.targetStatuses),
			careerField: plan.careerField
				? {
						...plan.careerField,
						relatedCategories: JSON.parse(plan.careerField.relatedCategories),
						recommendedActivities: JSON.parse(plan.careerField.recommendedActivities),
					}
				: null,
		},
	});
};

/** POST /api/v1/career-plans/:childId — 新規プラン作成 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (!Number.isInteger(childId) || childId <= 0) {
		throw error(400, { message: '不正な子供IDです' });
	}

	const child = await findChildById(childId, tenantId);
	if (!child) throw error(404, { message: '子供が見つかりません' });

	const body = await request.json();
	const parsed = createCareerPlanSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, { message: parsed.error.issues[0]?.message ?? 'バリデーションエラー' });
	}

	const result = await createCareerPlan(childId, parsed.data, tenantId);

	return json({
		plan: {
			...result.plan,
			mandalaChart: JSON.parse(result.plan.mandalaChart),
			targetStatuses: JSON.parse(result.plan.targetStatuses),
		},
		pointsAwarded: result.pointsAwarded,
	});
};

/** PUT /api/v1/career-plans/:childId — プラン更新 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (!Number.isInteger(childId) || childId <= 0) {
		throw error(400, { message: '不正な子供IDです' });
	}

	const child = await findChildById(childId, tenantId);
	if (!child) throw error(404, { message: '子供が見つかりません' });

	const existing = await getActiveCareerPlan(childId, tenantId);
	if (!existing) {
		throw error(404, { message: 'アクティブなキャリアプランがありません' });
	}

	const body = await request.json();
	const parsed = updateCareerPlanSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, { message: parsed.error.issues[0]?.message ?? 'バリデーションエラー' });
	}

	const result = await updateCareerPlanWithPoints(existing.id, childId, parsed.data, tenantId);

	return json({
		plan: {
			...result.plan,
			mandalaChart: JSON.parse(result.plan?.mandalaChart ?? '{}'),
			targetStatuses: JSON.parse(result.plan?.targetStatuses ?? '{}'),
		},
		pointsAwarded: result.pointsAwarded,
	});
};
