import { fail } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
// #2365 (ADR-0052): activity-pack を新 Strategy + dispatchImport 経由に移行。
// `$lib/marketplace` の eager-load (`./types/activity-pack`) で Registry 登録される。
import { dispatchImport } from '$lib/marketplace';
import { FileSourceError, loadActivityPackFromFile } from '$lib/marketplace/sources/file-source';
import { loadFromMarketplace } from '$lib/marketplace/sources/marketplace-source';
import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
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
	copyChildActivitiesToSibling,
	copyChildActivitiesToSiblings,
} from '$lib/server/services/child-activity-copy-service';
// #2362 PR-3 Phase 4: per-child instance 取得 + 兄弟共通化 copy
import { getAllChildren } from '$lib/server/services/child-service';
import {
	checkActivityLimit,
	isPaidTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	const tenantId = requireTenantId(locals);
	const activities = await getActivities(tenantId, { includeHidden: true });
	const logCounts = await getActivityLogCounts(tenantId);
	const mainQuestCount = await getMainQuestCount(tenantId);

	// #2362 PR-3 Phase 4: 子供別 per-child activity instance ロード
	// 子供タブ切替 UI 用に家族の child 全件を取得 + 各 child の per-child activities を取得
	const children = await getAllChildren(tenantId);
	const repos = getRepos();
	const childActivitiesByChild: Record<
		number,
		Awaited<ReturnType<typeof repos.childActivity.findActivitiesByChild>>
	> = {};
	for (const child of children) {
		childActivitiesByChild[child.id] = await repos.childActivity.findActivitiesByChild(
			child.id,
			tenantId,
			{ includeArchived: false },
		);
	}

	// `?import=<presetId>` query で ChildSelectionDialog auto-open
	const importPresetId = url.searchParams.get('import')?.trim() || null;
	// `?childId=<n>` query で初期選択 child 復元 (refresh / share link 対応)
	const initialChildIdRaw = url.searchParams.get('childId');
	const initialChildId =
		initialChildIdRaw && /^\d+$/.test(initialChildIdRaw) ? Number(initialChildIdRaw) : null;

	// Round 18 Cluster K (#1870 評価 Round 3): selectedChildId cookie fallback
	// `?childId=` 未指定時は cookie に保存された前回選択 child を採用する。
	// 既存 (child) 配下 route の selectedChildId cookie SSOT (src/routes/(child)/+layout.server.ts) と整合。
	// preschool 親が marketplace (ひな選択) → admin/activities 遷移時、たろうくんタブが active になる
	// 不整合 (memory `feedback_per_child_scope_consistency`) を解消し、選択 child の文脈を保持する。
	const cookieChildIdRaw = cookies.get('selectedChildId');
	const initialChildIdFromCookie = (() => {
		if (!cookieChildIdRaw) return null;
		const n = Number(cookieChildIdRaw);
		return Number.isInteger(n) && n > 0 ? n : null;
	})();

	// プラン制限情報
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const activityLimit = await checkActivityLimit(tenantId, licenseStatus);

	// #2558 段階2: admin 内マーケットプレイス風ブラウズ UI 撤去に伴い activityPacks load を削除。
	// プリセット閲覧・選択は /marketplace 側でのみ行う (PO 方針: マーケットプレイス一本化)。
	// 取込実行は marketplace 詳細 → /admin/activities?import=<presetId> → importPackToChildren で行う。

	const isPremium = isPaidTier(
		await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan),
	);

	return {
		activities,
		children,
		childActivitiesByChild,
		importPresetId,
		initialChildId,
		initialChildIdFromCookie,
		categoryDefs: CATEGORY_DEFS,
		logCounts,
		activityLimit,
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

		// #2365 (ADR-0052): Strategy + dispatchImport 経由
		try {
			const source = loadFromMarketplace('activity-pack', packId);
			const result = await dispatchImport({
				typeCode: 'activity-pack',
				rawPayload: source.payload,
				displayName: source.displayName,
				ctx: { tenantId, presetId: packId },
			});
			return result;
		} catch (e) {
			if (e instanceof Error && e.message.includes('not found in marketplace SSOT')) {
				return fail(404, { error: 'パックが見つかりません' });
			}
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
				// #2754 Fix Round 1 B3-b: audit trail (活動非表示化、活動ログ保全)
				logger.info('[admin/activities] 活動非表示化 (ログ有 soft delete)', {
					context: { activityId: id, tenantId, mode: 'hidden' },
				});
				return { hidden: true };
			}

			await deleteActivityWithCleanup(id, tenantId);
			// #2754 Fix Round 1 B3-b: audit trail (活動物理削除、復元不能)
			logger.info('[admin/activities] 活動削除 (ログ無 hard delete)', {
				context: { activityId: id, tenantId, mode: 'deleted' },
			});
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

		// #2365 (ADR-0052): Strategy + dispatchImport 経由 + file-source adapter
		let loaded: { activities: unknown[]; displayName: string };
		try {
			loaded = (await loadActivityPackFromFile(file as File)) as {
				activities: unknown[];
				displayName: string;
			};
		} catch (e) {
			if (e instanceof FileSourceError) {
				return fail(400, { error: e.message });
			}
			logger.error('[admin/activities] ファイル解析失敗', {
				error: e instanceof Error ? e.message : String(e),
			});
			return fail(400, { error: 'ファイルの解析に失敗しました' });
		}

		try {
			const result = await dispatchImport({
				typeCode: 'activity-pack',
				rawPayload: { activities: loaded.activities },
				displayName: loaded.displayName,
				ctx: { tenantId },
			});
			return result;
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

	// #2362 PR-3 Phase 4: per-child 取込 (ChildSelectionDialog から呼出)
	// `?import=<presetId>` query で auto-open した dialog で「全員 / 個別」選択 → 本 action に POST
	// childIds=all で全 child、childIds=1,2,3 で個別 child 配列
	importPackToChildren: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const packId = String(formData.get('packId') ?? '').trim();
		const childIdsRaw = String(formData.get('childIds') ?? '').trim();

		if (!packId) return fail(400, { error: 'パックIDが必要です' });
		if (!childIdsRaw) return fail(400, { error: '対象のお子さまを選択してください' });

		// childIds: 'all' or comma-separated number list
		let childIds: number[] | undefined;
		if (childIdsRaw === 'all') {
			const children = await getAllChildren(tenantId);
			childIds = children.map((c) => c.id);
		} else {
			childIds = childIdsRaw
				.split(',')
				.map((s) => Number(s.trim()))
				.filter((n) => Number.isInteger(n) && n > 0);
		}

		if (!childIds || childIds.length === 0) {
			return fail(400, { error: '有効な対象が指定されていません' });
		}

		try {
			const source = loadFromMarketplace('activity-pack', packId);
			const result = await dispatchImport({
				typeCode: 'activity-pack',
				rawPayload: source.payload,
				displayName: source.displayName,
				ctx: { tenantId, presetId: packId, childIds },
			});
			return { perChildImport: true, ...result };
		} catch (e) {
			if (e instanceof Error && e.message.includes('not found in marketplace SSOT')) {
				return fail(404, { error: 'パックが見つかりません' });
			}
			logger.error('[admin/activities] per-child 取込失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { packId, childIds },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},

	// #2362 PR-3 Phase 4: 「他の子供から copy」action
	// source child の activity 全件を target child (現在の表示 child) に複製
	// targetChildIds (CSV) 指定で複数 target にも一括複製可能 (兄弟全員に同期)
	copyFromChild: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const sourceChildId = Number(formData.get('sourceChildId'));
		const targetChildIdsRaw = String(formData.get('targetChildIds') ?? '').trim();
		const singleTargetChildId = Number(formData.get('targetChildId'));

		if (!sourceChildId) {
			return fail(400, { error: 'コピー元のお子さまが必要です' });
		}

		// targetChildIds (CSV) 優先、なければ targetChildId (単一) を使う
		let targetChildIds: number[] | null = null;
		if (targetChildIdsRaw) {
			targetChildIds = targetChildIdsRaw
				.split(',')
				.map((s) => Number(s.trim()))
				.filter((n) => Number.isInteger(n) && n > 0);
		} else if (singleTargetChildId) {
			targetChildIds = [singleTargetChildId];
		}

		if (!targetChildIds || targetChildIds.length === 0) {
			return fail(400, { error: 'コピー先のお子さまが必要です' });
		}

		try {
			const target = targetChildIds[0];
			if (targetChildIds.length === 1 && target !== undefined) {
				if (sourceChildId === target) {
					return fail(400, { error: '同じお子さまにはコピーできません' });
				}
				const copied = await copyChildActivitiesToSibling(tenantId, sourceChildId, target);
				return { copyResult: true, copiedCount: copied.length };
			}
			const result = await copyChildActivitiesToSiblings({
				tenantId,
				sourceChildId,
				targetChildIds,
			});
			if (result.errors.length > 0) {
				logger.warn('[admin/activities] 兄弟へのコピーで partial failure', {
					context: { sourceChildId, errorCount: result.errors.length },
				});
			}
			return {
				copyResult: true,
				copiedCount: result.totalCopied,
				errorCount: result.errors.length,
			};
		} catch (e) {
			logger.error('[admin/activities] copy 失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { sourceChildId, targetChildIds },
			});
			return fail(500, { error: 'コピーに失敗しました' });
		}
	},

	// #2362 PR-3 Phase 4: 「一括追加」action (新規 activity を複数 child に同時 create)
	// 子供選択 (childIds) を受領し、各 child の child_activities に同一 activity を bulk insert
	bulkCreateForChildren: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const name = String(formData.get('name') ?? '').trim();
		const categoryId = Number(formData.get('categoryId') ?? 0);
		const icon = String(formData.get('icon') ?? '📝');
		const basePoints = Number(formData.get('basePoints') ?? 5);
		const dailyLimitRaw = formData.get('dailyLimit');
		const dailyLimit = dailyLimitRaw != null && dailyLimitRaw !== '' ? Number(dailyLimitRaw) : null;
		const childIdsRaw = String(formData.get('childIds') ?? '').trim();

		if (!name) return fail(400, { error: '名前を入力してください' });
		if (!categoryId || categoryId < 1 || categoryId > 5) {
			return fail(400, { error: 'カテゴリを選択してください' });
		}
		if (!childIdsRaw) return fail(400, { error: '対象のお子さまを選択してください' });

		let childIds: number[];
		if (childIdsRaw === 'all') {
			const children = await getAllChildren(tenantId);
			childIds = children.map((c) => c.id);
		} else {
			childIds = childIdsRaw
				.split(',')
				.map((s) => Number(s.trim()))
				.filter((n) => Number.isInteger(n) && n > 0);
		}
		if (childIds.length === 0) {
			return fail(400, { error: '有効な対象が指定されていません' });
		}

		const repos = getRepos();
		const inputs = childIds.map((childId) => ({
			childId,
			categoryId,
			name,
			icon,
			basePoints,
			dailyLimit,
			source: 'parent' as const,
		}));

		try {
			const created = await repos.childActivity.insertActivitiesBulk(inputs, tenantId);
			return { bulkCreated: true, createdCount: created.length };
		} catch (e) {
			logger.error('[admin/activities] 一括追加失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { name, categoryId, childIds },
			});
			return fail(500, { error: '一括追加に失敗しました' });
		}
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

// #2365 (ADR-0052): 旧 parseCsvActivities は `$lib/marketplace/sources/file-source.ts` に移管
