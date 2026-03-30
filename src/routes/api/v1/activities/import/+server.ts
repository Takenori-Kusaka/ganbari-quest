import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	importActivities,
	previewActivityImport,
} from '$lib/server/services/activity-import-service';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const validCategoryCodes = new Set<string>(CATEGORY_CODES);

function validateActivities(data: unknown): ActivityPackItem[] {
	if (!data || typeof data !== 'object') throw new Error('リクエストボディが不正です');
	const body = data as Record<string, unknown>;
	const activities = body.activities;
	if (!Array.isArray(activities) || activities.length === 0) {
		throw new Error('activities配列が空です');
	}
	if (activities.length > 100) {
		throw new Error('一度にインポートできる活動は100件までです');
	}

	return activities.map((a: unknown, i: number) => {
		const item = a as Record<string, unknown>;
		if (!item.name || typeof item.name !== 'string') {
			throw new Error(`activities[${i}]: nameが不正です`);
		}
		if (!item.categoryCode || !validCategoryCodes.has(item.categoryCode as string)) {
			throw new Error(`activities[${i}]: categoryCodeが不正です`);
		}
		return {
			name: item.name as string,
			categoryCode: item.categoryCode as ActivityPackItem['categoryCode'],
			icon: (item.icon as string) ?? '⭐',
			basePoints: typeof item.basePoints === 'number' ? item.basePoints : 5,
			ageMin: typeof item.ageMin === 'number' ? item.ageMin : null,
			ageMax: typeof item.ageMax === 'number' ? item.ageMax : null,
			gradeLevel: (item.gradeLevel as ActivityPackItem['gradeLevel']) ?? null,
			triggerHint: (item.triggerHint as string) ?? undefined,
			nameKana: (item.nameKana as string) ?? undefined,
			nameKanji: (item.nameKanji as string) ?? undefined,
		};
	});
}

export const POST: RequestHandler = async ({ request, url, locals }) => {
	const tenantId = requireTenantId(locals);
	const mode = url.searchParams.get('mode') ?? 'preview';

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'JSONの解析に失敗しました');
	}

	let activities: ActivityPackItem[];
	try {
		activities = validateActivities(body);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'バリデーションエラー');
	}

	if (mode === 'preview') {
		const preview = await previewActivityImport(activities, tenantId);
		return json(preview);
	}

	if (mode === 'merge') {
		const result = await importActivities(activities, tenantId);
		return json(result);
	}

	error(400, `不正なモード: ${mode}`);
};
