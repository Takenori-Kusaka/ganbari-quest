import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { getActivities } from '$lib/server/services/activity-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const CATEGORY_ID_TO_CODE: Record<number, string> = {};
for (const [i, code] of CATEGORY_CODES.entries()) {
	CATEGORY_ID_TO_CODE[i + 1] = code;
}

export const GET: RequestHandler = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const activities = await getActivities(tenantId, { includeHidden: false });

	const exportData = {
		formatVersion: '1.0' as const,
		packId: 'user-export',
		packName: 'エクスポートされた活動',
		description: `${activities.length}件の活動をエクスポート`,
		icon: '📤',
		targetAgeMin: 0,
		targetAgeMax: 15,
		tags: ['エクスポート'],
		activities: activities.map((a) => ({
			name: a.name,
			nameKana: a.nameKana ?? undefined,
			nameKanji: a.nameKanji ?? undefined,
			categoryCode: CATEGORY_ID_TO_CODE[a.categoryId] ?? 'seikatsu',
			icon: a.icon,
			basePoints: a.basePoints,
			ageMin: a.ageMin,
			ageMax: a.ageMax,
			gradeLevel: null,
			triggerHint: a.triggerHint ?? undefined,
			description: a.description ?? undefined,
		})),
	};

	return json(exportData, {
		headers: {
			'Content-Disposition': 'attachment; filename="activities-export.json"',
		},
	});
};
