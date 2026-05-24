import { json } from '@sveltejs/kit';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { getActivities } from '$lib/server/services/activity-service';
import type { RequestHandler } from './$types';

const CATEGORY_ID_TO_CODE: Record<number, string> = {};
for (const [i, code] of CATEGORY_CODES.entries()) {
	CATEGORY_ID_TO_CODE[i + 1] = code;
}

export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
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
		// #2362 PR-3 Phase 7b-2c: ChildActivity は ageMin/ageMax/description/gradeLevel を持たない。
		// export 形式は v1.0 互換維持のため key は残し、値は null/undefined で出力 (downstream
		// import で fallback 動作する)。Phase 7b-2d 以降で export schema v2 への移行を検討。
		activities: activities.map((a) => ({
			name: a.name,
			nameKana: a.nameKana ?? undefined,
			nameKanji: a.nameKanji ?? undefined,
			categoryCode: CATEGORY_ID_TO_CODE[a.categoryId] ?? 'seikatsu',
			icon: a.icon,
			basePoints: a.basePoints,
			ageMin: null,
			ageMax: null,
			gradeLevel: null,
			triggerHint: a.triggerHint ?? undefined,
			description: undefined,
		})),
	};

	return json(exportData, {
		headers: {
			'Content-Disposition': 'attachment; filename="activities-export.json"',
		},
	});
};
