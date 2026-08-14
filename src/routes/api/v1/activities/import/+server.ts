import { error, json } from '@sveltejs/kit';
import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
// #2365 (ADR-0052): 新 Strategy + dispatchImport 経由
import { dispatchImport, marketplaceRegistry } from '$lib/marketplace';
import type { ActivityPackPayload } from '$lib/marketplace/schemas/activity-pack-schema';
import { requireRole } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { checkActivityLimit } from '$lib/server/services/plan-limit-service';
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
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	// #3334: 家族データの取込 (管理操作) は owner / parent 専用。ROUTE_RULES の /api/v1 は
	// child も到達を許すため、他の import 系 endpoint (/api/v1/import, /api/v1/import/cloud) と
	// 同様に in-handler で owner-gate し、child が家族の活動を勝手に取り込めないようにする。
	requireRole(locals, ['owner', 'parent']);
	const tenantId = context.tenantId;
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

	const descriptor = marketplaceRegistry.get('activity-pack');
	const rawPayload = { activities };
	let payload: ActivityPackPayload;
	try {
		payload = descriptor.strategy.parse(rawPayload) as ActivityPackPayload;
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'スキーマエラー');
	}

	if (mode === 'preview') {
		const preview = await descriptor.strategy.preview(payload, { tenantId });
		// API 後方互換: 旧 service の戻り値 shape (`newActivities` field) を維持
		return json({
			total: preview.total,
			newActivities: preview.newItems,
			duplicates: preview.duplicates,
			duplicateNames: preview.duplicateNames,
			byCategory: preview.byCategory,
		});
	}

	if (mode === 'merge') {
		// #3759: admin importPack (#2894) と同型の quota gate。#3753 で POST / copyFromChild に
		// gate を追加した際、本 import mode=merge 経路のみ checkActivityLimit 未通過で非対称だった
		// (5 producer のうち唯一の gate 漏れ)。free tier (maxActivities) の上限を全 producer で対称に enforce する。
		// (source 強制は不要: 本 endpoint は client 供給 source 欄を持たず、取込活動は import strategy が
		//  seed source を付与するため #3753 POST の wire source 上書きは N/A。)
		const licenseStatus = context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
		const limitCheck = await checkActivityLimit(tenantId, licenseStatus);
		if (!limitCheck.allowed) {
			return apiError(
				'PLAN_LIMIT_EXCEEDED',
				PLAN_GATE_LABELS.activityLimitReached(limitCheck.max),
				{ current: limitCheck.current, max: limitCheck.max },
			);
		}

		const result = await dispatchImport({
			typeCode: 'activity-pack',
			rawPayload,
			displayName: 'api-v1-import',
			ctx: { tenantId },
		});
		return json({
			imported: result.imported,
			skipped: result.skipped,
			errors: result.errors,
		});
	}

	error(400, `不正なモード: ${mode}`);
};
