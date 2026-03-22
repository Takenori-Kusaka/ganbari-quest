import { getActiveCareerPlan, getCareerFields } from '$lib/server/services/career-service';
import { getAllChildren } from '$lib/server/services/child-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const children = await getAllChildren();
	const allFields = await getCareerFields();

	const fieldsMap = Object.fromEntries(
		allFields.map((f) => [f.id, { ...f, relatedCategories: JSON.parse(f.relatedCategories) }]),
	);

	const childrenWithPlans = await Promise.all(
		children.map(async (child) => {
			const plan = await getActiveCareerPlan(child.id);
			return {
				...child,
				plan: plan
					? {
							...plan,
							mandalaChart: JSON.parse(plan.mandalaChart),
							careerField: plan.careerField
								? {
										...plan.careerField,
										relatedCategories: JSON.parse(plan.careerField.relatedCategories),
									}
								: null,
						}
					: null,
			};
		}),
	);

	return { children: childrenWithPlans, careerFields: fieldsMap };
};
