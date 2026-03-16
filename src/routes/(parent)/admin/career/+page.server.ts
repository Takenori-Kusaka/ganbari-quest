import { getCareerFields, getActiveCareerPlan } from '$lib/server/services/career-service';
import { getAllChildren } from '$lib/server/services/child-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const children = getAllChildren();
	const allFields = getCareerFields();

	const fieldsMap = Object.fromEntries(
		allFields.map((f) => [f.id, { ...f, relatedCategories: JSON.parse(f.relatedCategories) }]),
	);

	const childrenWithPlans = children.map((child) => {
		const plan = getActiveCareerPlan(child.id);
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
	});

	return { children: childrenWithPlans, careerFields: fieldsMap };
};
