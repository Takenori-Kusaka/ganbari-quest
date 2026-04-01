import { activityPackIndex, getActivityPack } from '$lib/data/activity-packs';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
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
	hasActivityLogs,
	setActivityVisibility,
	updateActivity,
} from '$lib/server/services/activity-service';
import { checkActivityLimit } from '$lib/server/services/plan-limit-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const activities = await getActivities(tenantId, { includeHidden: true });
	const logCounts = await getActivityLogCounts(tenantId);

	// プラン制限情報
	const licenseStatus = locals.context?.licenseStatus ?? 'none';
	const activityLimit = await checkActivityLimit(tenantId, licenseStatus);

	// プリセットパック一覧
	const activityPacks = activityPackIndex.packs;

	return { activities, categoryDefs: CATEGORY_DEFS, logCounts, activityLimit, activityPacks };
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
		const licenseStatus = locals.context?.licenseStatus ?? 'none';
		const activityLimitCheck = await checkActivityLimit(tenantId, licenseStatus);
		if (!activityLimitCheck.allowed) {
			return fail(403, {
				error: `カスタム活動は最大${activityLimitCheck.max}個まで作成できます。プランをアップグレードしてください。`,
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

	edit: async ({ request, locals }) => {
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
				},
				tenantId,
			);
			return { edited: true };
		} catch (e) {
			logger.error('[admin/activities] 活動編集失敗', {
				error: e instanceof Error ? e.message : String(e),
				stack: e instanceof Error ? e.stack : undefined,
				context: { id, name },
			});
			return fail(500, { error: '更新に失敗しました' });
		}
	},

	importPack: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const packId = String(formData.get('packId') ?? '').trim();

		if (!packId) return fail(400, { error: 'パックIDが必要です' });

		const pack = getActivityPack(packId);
		if (!pack) return fail(404, { error: 'パックが見つかりません' });

		try {
			const preview = await previewActivityImport(pack.activities, tenantId);
			const result = await importActivities(pack.activities, tenantId);
			return {
				importResult: true,
				packName: pack.packName,
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
};
