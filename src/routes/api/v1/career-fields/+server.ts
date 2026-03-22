import { getCareerFields } from '$lib/server/services/career-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const ageParam = url.searchParams.get('age');
	const age = ageParam ? Number(ageParam) : undefined;

	const careerFields = await getCareerFields(age);

	// JSON文字列を解析して返す
	const fields = careerFields.map((f) => ({
		...f,
		relatedCategories: JSON.parse(f.relatedCategories),
		recommendedActivities: JSON.parse(f.recommendedActivities),
	}));

	return json({ careerFields: fields });
};
