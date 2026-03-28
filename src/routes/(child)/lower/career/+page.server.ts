import { requireTenantId } from '$lib/server/auth/factory';
import { getActiveCareerPlan, getCareerFields } from '$lib/server/services/career-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { plan: null, careerFields: [] };

	const plan = await getActiveCareerPlan(child.id, tenantId);
	const careerFields = await getCareerFields(tenantId, child.age);

	// JSON文字列を解析
	const fields = careerFields.map((f) => ({
		...f,
		relatedCategories: JSON.parse(f.relatedCategories) as number[],
		recommendedActivities: JSON.parse(f.recommendedActivities) as number[],
	}));

	const parsedPlan = plan
		? {
				...plan,
				mandalaChart: JSON.parse(plan.mandalaChart),
				targetStatuses: JSON.parse(plan.targetStatuses),
				careerField: plan.careerField
					? {
							...plan.careerField,
							relatedCategories: JSON.parse(plan.careerField.relatedCategories) as number[],
							recommendedActivities: JSON.parse(plan.careerField.recommendedActivities) as number[],
						}
					: null,
			}
		: null;

	return { plan: parsedPlan, careerFields: fields };
};
