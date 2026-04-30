import { fail } from '@sveltejs/kit';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import type { ActivityPackPayload } from '$lib/domain/marketplace-item';
import { CATEGORY_CODES, CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import {
	importActivities,
	previewActivityImport,
} from '$lib/server/services/activity-import-service';
import {
	createActivity,
	deleteActivityWithCleanup,
	getActivities,
	getActivityLogCounts,
	getMainQuestCount,
	hasActivityLogs,
	MAIN_QUEST_MAX,
	setActivityVisibility,
	setMainQuest,
	updateActivity,
} from '$lib/server/services/activity-service';
import {
	checkActivityLimit,
	isPaidTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const activities = await getActivities(tenantId, { includeHidden: true });
	const logCounts = await getActivityLogCounts(tenantId);
	const mainQuestCount = await getMainQuestCount(tenantId);

	// プラン制限情報
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const activityLimit = await checkActivityLimit(tenantId, licenseStatus);

	// プリセットパック一覧（marketplace SSOT から activity-pack のみ抽出してレガシー形状に整形）
	const activityPacks = getMarketplaceIndex()
		.filter((m) => m.type === 'activity-pack')
		.map((m) => ({
			packId: m.itemId,
			packName: m.name,
			description: m.description,
			icon: m.icon,
			targetAgeMin: m.targetAgeMin,
			targetAgeMax: m.targetAgeMax,
			tags: m.tags,
			activityCount: m.itemCount,
		}));

	const isPremium = isPaidTier(
		await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan),
	);

	return {
		activities,
		categoryDefs: CATEGORY_DEFS,
		logCounts,
		activityLimit,
		activityPacks,
		isPremium,
		mainQuestCount,
		mainQuestMax: MAIN_QUEST_MAX,
	};
};

export const actions: Actions = {
	toggleVisibility: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const visible = formData.get('visible') === 'true';

		if (!id) return fail(400, { error: 'IDが必要です' });

		try {
			await setActivityVisibility(id, visible, tenantId);
			return { success: true };
		} catch (e) {
			logger.error('[admin/activities] 表示切替失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { id, visible },
			});
			return fail(500, { error: '更新に失敗しました' });
		}
	},

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
	create: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const name = String(formData.get('name') ?? '').trim();
		const categoryId = Number(formData.get('categoryId') ?? 0);
		const icon = String(formData.get('icon') ?? '📝');
		const basePoints = Number(formData.get('basePoints') ?? 5);
		const ageMin = formData.get('ageMin') ? Number(formData.get('ageMin')) : null;
		const ageMax = formData.get('ageMax') ? Number(formData.get('ageMax')) : null;
		const dailyLimitRaw = formData.get('dailyLimit');
		const dailyLimit = dailyLimitRaw != null && dailyLimitRaw !== '' ? Number(dailyLimitRaw) : null;
		const nameKana = String(formData.get('nameKana') ?? '').trim() || null;
		const nameKanji = String(formData.get('nameKanji') ?? '').trim() || null;
		const triggerHint = String(formData.get('triggerHint') ?? '').trim() || null;

		if (!name) return fail(400, { error: '名前を入力してください' });
		if (!categoryId || categoryId < 1 || categoryId > 5) {
			return fail(400, { error: 'カテゴリを選択してください' });
		}

		// プラン制限チェック（カスタム活動数）
		const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
		const activityLimitCheck = await checkActivityLimit(tenantId, licenseStatus);
		if (!activityLimitCheck.allowed) {
			// #787: PlanLimitError 形式に統一。tier は memoize 済み (#788) なので 2 回目の呼び出しは安い
			const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
			return fail(403, {
				error: createPlanLimitError(
					tier,
					'standard',
					`カスタム活動は最大${activityLimitCheck.max}個まで作成できます。プランをアップグレードしてください。`,
				),
			});
		}

		try {
			await createActivity(
				{
					name,
					categoryId,
					icon,
					basePoints,
					ageMin,
					ageMax,
					dailyLimit,
					source: 'parent',
					nameKana,
					nameKanji,
					triggerHint,
				},
				tenantId,
			);
			return { created: true };
		} catch (e) {
			logger.error('[admin/activities] 活動追加失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { name, categoryId },
			});
			return fail(500, { error: '追加に失敗しました' });
		}
	},

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
	edit: async ({ request, locals }) => {
		// #1756 (#1709-B): 編集 UI は /admin/activities/[id]/edit に分離済み。
		//   本 action は API 互換性のため残し、priority も受理する。
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const name = String(formData.get('name') ?? '').trim();
		const categoryId = Number(formData.get('categoryId') ?? 0);
		const icon = String(formData.get('icon') ?? '📝');
		const basePoints = Number(formData.get('basePoints') ?? 5);
		const ageMin = formData.get('ageMin') ? Number(formData.get('ageMin')) : null;
		const ageMax = formData.get('ageMax') ? Number(formData.get('ageMax')) : null;
		const dailyLimitRaw = formData.get('dailyLimit');
		const dailyLimit = dailyLimitRaw != null && dailyLimitRaw !== '' ? Number(dailyLimitRaw) : null;
		const nameKana = String(formData.get('nameKana') ?? '').trim() || null;
		const nameKanji = String(formData.get('nameKanji') ?? '').trim() || null;
		const triggerHint = String(formData.get('triggerHint') ?? '').trim() || null;
		// #1756 (#1709-B): must トグル — checkbox の value="must"。未指定は 'optional'
		const priorityRaw = formData.get('priority');
		const priority: 'must' | 'optional' = priorityRaw === 'must' ? 'must' : 'optional';

		if (!id) return fail(400, { error: 'IDが必要です' });
		if (!name) return fail(400, { error: '名前を入力してください' });
		if (!categoryId || categoryId < 1 || categoryId > 5) {
			return fail(400, { error: 'カテゴリを選択してください' });
		}

		try {
			await updateActivity(
				id,
				{
					name,
					categoryId,
					icon,
					basePoints,
					ageMin,
					ageMax,
					dailyLimit,
					nameKana,
					nameKanji,
					triggerHint,
					priority,
				},
				tenantId,
			);
			return { edited: true };
		} catch (e) {
			logger.error('[admin/activities] 活動編集失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { id, name, priority },
			});
			return fail(500, { error: '更新に失敗しました' });
		}
	},

	importPack: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const packId = String(formData.get('packId') ?? '').trim();

		if (!packId) return fail(400, { error: 'パックIDが必要です' });

		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return fail(404, { error: 'パックが見つかりません' });

		try {
			const activities = (pack.payload as ActivityPackPayload).activities as ActivityPackItem[];
			const preview = await previewActivityImport(activities, tenantId);
			const result = await importActivities(activities, tenantId, packId);
			return {
				importResult: true,
				packName: pack.name,
				imported: result.imported,
				skipped: result.skipped,
				total: preview.total,
				errors: result.errors,
			};
		} catch (e) {
			logger.error('[admin/activities] パックインポート失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { packId },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},

	delete: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id) return fail(400, { error: 'IDが必要です' });

		try {
			if (await hasActivityLogs(id, tenantId)) {
				await setActivityVisibility(id, false, tenantId);
				return { hidden: true };
			}

			await deleteActivityWithCleanup(id, tenantId);
			return { deleted: true };
		} catch (e) {
			logger.error('[admin/activities] 活動削除失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { id },
			});
			return fail(500, { error: '削除に失敗しました' });
		}
	},

	importFile: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const file = formData.get('file') as File | null;

		if (!file || file.size === 0) {
			return fail(400, { error: 'ファイルを選択してください' });
		}

		const text = await file.text();
		let activities: ActivityPackItem[];

		try {
			if (file.name.endsWith('.csv')) {
				activities = parseCsvActivities(text);
			} else {
				const parsed = JSON.parse(text);
				activities = parsed.activities ?? parsed;
				if (!Array.isArray(activities)) {
					return fail(400, { error: 'JSONの形式が正しくありません' });
				}
			}
		} catch {
			return fail(400, { error: 'ファイルの解析に失敗しました' });
		}

		if (activities.length === 0) {
			return fail(400, { error: 'インポートする活動がありません' });
		}

		try {
			const preview = await previewActivityImport(activities, tenantId);
			const result = await importActivities(activities, tenantId);
			return {
				importResult: true,
				packName: file.name,
				imported: result.imported,
				skipped: result.skipped,
				total: preview.total,
				errors: result.errors,
			};
		} catch (e) {
			logger.error('[admin/activities] ファイルインポート失敗', {
				error: e instanceof Error ? e.message : String(e),
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},

	toggleMainQuest: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const enabled = formData.get('enabled') === 'true';

		if (!id) return fail(400, { error: 'IDが必要です' });

		const result = await setMainQuest(id, enabled, tenantId);
		if ('error' in result) {
			return fail(400, { error: result.error });
		}
		return { success: true };
	},

	clearAll: async ({ locals }) => {
		const tenantId = requireTenantId(locals);

		try {
			const activities = await getActivities(tenantId, { includeHidden: true });
			let deleted = 0;
			let hidden = 0;

			for (const activity of activities) {
				if (await hasActivityLogs(activity.id, tenantId)) {
					await setActivityVisibility(activity.id, false, tenantId);
					hidden++;
				} else {
					await deleteActivityWithCleanup(activity.id, tenantId);
					deleted++;
				}
			}

			return { clearResult: true, deleted, hidden };
		} catch (e) {
			logger.error('[admin/activities] 一括クリア失敗', {
				error: e instanceof Error ? e.message : String(e),
			});
			return fail(500, { error: '一括クリアに失敗しました' });
		}
	},
};

/** CSV を ActivityPackItem[] に変換 */
function parseCsvActivities(text: string): ActivityPackItem[] {
	const lines = text.split('\n').filter((l) => l.trim());
	if (lines.length < 2) return [];

	// ヘッダー行をスキップ
	const validCodes = new Set<string>(CATEGORY_CODES);
	const items: ActivityPackItem[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const cols = line.split(',').map((c) => c.trim());
		if (cols.length < 4) continue;

		const [name, categoryCode, icon, pointsStr, description] = cols;
		if (!name || !categoryCode || !validCodes.has(categoryCode)) continue;

		items.push({
			name,
			categoryCode: categoryCode as ActivityPackItem['categoryCode'],
			icon: icon || '📝',
			basePoints: Number(pointsStr) || 5,
			ageMin: null,
			ageMax: null,
			gradeLevel: null,
			description: description || undefined,
		});
	}

	return items;
}
