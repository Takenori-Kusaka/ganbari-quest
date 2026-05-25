// admin/challenges/+page.server.ts
// per-child チャレンジ管理 + 兄弟連動表示 (#2362 PR-7、ADR-0055、User §6)
//
// 旧 family-wide sibling_challenges (createSiblingChallenge → 全員自動 enroll) は
// 並存維持 (sibling-challenge-service が継続稼働、cleanup は #2458)。
// 本 page は新 child_challenges (per-child instance) を SSOT として扱う。

import { fail } from '@sveltejs/kit';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import type { ChallengeSetPayload } from '$lib/domain/marketplace-item';
import { dispatchImport } from '$lib/marketplace';
import { loadFromMarketplace } from '$lib/marketplace/sources/marketplace-source';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { copyChildChallengesToSiblings } from '$lib/server/services/child-challenge-copy-service';
import {
	buildPerChildTargets,
	createChildChallenge,
	createChildChallengesBulk,
	deleteChildChallenge,
	getChallengeGroupsForAdmin,
} from '$lib/server/services/child-challenge-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { getFamilyStreak, getNextMilestone } from '$lib/server/services/family-streak-service';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const planTier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);

	const [challengeGroups, children, familyStreakData] = await Promise.all([
		getChallengeGroupsForAdmin(tenantId),
		getAllChildren(tenantId),
		getFamilyStreak(tenantId),
	]);

	const familyStreak = {
		...familyStreakData,
		nextMilestone: getNextMilestone(familyStreakData.currentStreak),
	};

	// 子供別タブ切替 (?childId=N、未指定なら 'all')
	const childIdParam = url.searchParams.get('childId');
	const selectedChildId =
		childIdParam && childIdParam !== 'all' ? Number(childIdParam) : ('all' as const);

	// 取込時 ChildSelectionDialog auto-open (#2362 PR-7, CWE-598)
	const importPresetId = url.searchParams.get('marketplace-import');
	let marketplaceImport: {
		presetId: string;
		presetName: string;
		presetDescription: string;
		challenges: ChallengeSetPayload['challenges'];
	} | null = null;
	if (importPresetId) {
		const item = getMarketplaceItem('challenge-set', importPresetId);
		if (item) {
			const payload = item.payload as ChallengeSetPayload;
			marketplaceImport = {
				presetId: item.itemId,
				presetName: item.name,
				presetDescription: item.description,
				challenges: payload.challenges,
			};
		}
	}

	const challengePresets = getMarketplaceIndex()
		.filter((m) => m.type === 'challenge-set')
		.map((m) => ({
			itemId: m.itemId,
			name: m.name,
			icon: m.icon,
			itemCount: m.itemCount,
			targetAgeMin: m.targetAgeMin,
			targetAgeMax: m.targetAgeMax,
		}));

	return {
		challengeGroups,
		children,
		planTier,
		familyStreak,
		marketplaceImport,
		challengePresets,
		selectedChildId,
	};
};

export const actions: Actions = {
	// 単一 child に 1 challenge 作成 (admin form)
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: form 検証 + JSON 組立 + insert で複雑度 24、可読性のため fragment 分離せず維持
	create: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const childId = Number(fd.get('childId'));
		const title = String(fd.get('title') ?? '').trim();
		const description = String(fd.get('description') ?? '').trim() || null;
		// #2296 (EPIC #2294 ②): cooperative 固定 (新規作成、競争禁止)
		const challengeType = 'cooperative';
		const periodType = String(fd.get('periodType') ?? 'weekly');
		const startDate = String(fd.get('startDate') ?? '');
		const endDate = String(fd.get('endDate') ?? '');
		const metric = String(fd.get('metric') ?? 'count');
		const baseTarget = Number(fd.get('baseTarget') ?? 3);
		const categoryIdStr = String(fd.get('categoryId') ?? '');
		const categoryId = categoryIdStr ? Number(categoryIdStr) : undefined;
		const rewardPoints = Number(fd.get('rewardPoints') ?? 50);
		const rewardMessage = String(fd.get('rewardMessage') ?? '').trim() || undefined;

		if (!childId) return fail(400, { error: 'お子さまを選択してください' });
		if (!title) return fail(400, { error: 'タイトルを入力してください' });
		if (!startDate || !endDate) return fail(400, { error: '開始日・終了日を入力してください' });
		if (startDate > endDate) return fail(400, { error: '終了日は開始日以降にしてください' });
		if (baseTarget < 1) return fail(400, { error: '目標回数は1以上にしてください' });

		const targetConfig = JSON.stringify({
			metric,
			baseTarget,
			...(categoryId ? { categoryId } : {}),
		});
		const rewardConfig = JSON.stringify({
			points: rewardPoints,
			...(rewardMessage ? { message: rewardMessage } : {}),
		});

		try {
			await createChildChallenge(
				{
					childId,
					title,
					description,
					challengeType,
					periodType,
					startDate,
					endDate,
					targetConfig,
					rewardConfig,
					targetValue: baseTarget,
				},
				tenantId,
			);
			return { created: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'チャレンジ作成に失敗しました' });
		}
	},

	// 一括追加 (複数 child に同じ challenge を同時 instance 化、兄弟連動デモ向け)
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: form 検証 + JSON 組立 + bulk insert で複雑度 25、create と対称形のため分離せず維持
	bulkCreate: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const childIdsRaw = fd
			.getAll('childIds')
			.map((v) => Number(v))
			.filter((n) => !Number.isNaN(n));
		if (childIdsRaw.length === 0)
			return fail(400, { error: '対象お子さまを 1 名以上選択してください' });

		const title = String(fd.get('title') ?? '').trim();
		const description = String(fd.get('description') ?? '').trim() || null;
		const periodType = String(fd.get('periodType') ?? 'weekly');
		const startDate = String(fd.get('startDate') ?? '');
		const endDate = String(fd.get('endDate') ?? '');
		const metric = String(fd.get('metric') ?? 'count');
		const baseTarget = Number(fd.get('baseTarget') ?? 3);
		const categoryIdStr = String(fd.get('categoryId') ?? '');
		const categoryId = categoryIdStr ? Number(categoryIdStr) : undefined;
		const rewardPoints = Number(fd.get('rewardPoints') ?? 50);
		const rewardMessage = String(fd.get('rewardMessage') ?? '').trim() || undefined;
		const sourceTemplateId =
			String(fd.get('sourceTemplateId') ?? '').trim() || `bulk:${Date.now()}`;

		if (!title) return fail(400, { error: 'タイトルを入力してください' });
		if (!startDate || !endDate) return fail(400, { error: '開始日・終了日を入力してください' });
		if (baseTarget < 1) return fail(400, { error: '目標回数は1以上にしてください' });

		const targetConfig = JSON.stringify({
			metric,
			baseTarget,
			...(categoryId ? { categoryId } : {}),
		});
		const rewardConfig = JSON.stringify({
			points: rewardPoints,
			...(rewardMessage ? { message: rewardMessage } : {}),
		});

		const perChildTargets = await buildPerChildTargets(
			baseTarget,
			undefined,
			childIdsRaw,
			tenantId,
		);

		try {
			const created = await createChildChallengesBulk(
				{
					title,
					description,
					challengeType: 'cooperative',
					periodType,
					startDate,
					endDate,
					targetConfig,
					rewardConfig,
					sourceTemplateId,
					perChildTargets,
				},
				childIdsRaw,
				tenantId,
			);
			return { bulkCreated: created.length };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : '一括作成に失敗しました' });
		}
	},

	// 1 instance 削除
	delete: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!id) return fail(400, { error: 'IDが不正です' });
		await deleteChildChallenge(id, tenantId);
		return { deleted: true };
	},

	// cross-child copy (source 1 名 → targets 複数名)
	copyToSiblings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const sourceChildId = Number(fd.get('sourceChildId'));
		const targetChildIds = fd
			.getAll('targetChildIds')
			.map((v) => Number(v))
			.filter((n) => !Number.isNaN(n));
		if (!sourceChildId) return fail(400, { error: 'コピー元のお子さまが必要です' });
		if (targetChildIds.length === 0)
			return fail(400, { error: 'コピー先のお子さまを 1 名以上選択してください' });

		const result = await copyChildChallengesToSiblings({
			tenantId,
			sourceChildId,
			targetChildIds,
		});
		return {
			copyResult: {
				totalCopied: result.totalCopied,
				byTargetChild: result.byTargetChild,
				errorCount: result.errors.length,
			},
		};
	},

	// marketplace 取込 (per-child 配信、CWE-598: childIds は body のみ・URL に出さない)
	// #2402 QM must-3 (OWASP A01) family-only gate を維持 (LP/pricing 整合性は別 PR で判断)
	importMarketplaceChallengeSet: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
		const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
		if (tier !== 'family') {
			return fail(403, {
				error: createPlanLimitError(
					tier,
					'family',
					PLAN_GATE_LABELS.familyOnlyFor('きょうだいチャレンジ'),
				),
			});
		}

		const fd = await request.formData();
		const presetId = String(fd.get('presetId') ?? '').trim();
		if (!presetId) return fail(400, { error: 'presetId が必要です' });

		// #2362 PR-7: per-child 配信 (childIds body 必須、URL には出さない = CWE-598)
		const childIds = fd
			.getAll('childIds')
			.map((v) => Number(v))
			.filter((n) => !Number.isNaN(n));
		if (childIds.length === 0) {
			return fail(400, { error: 'お子さまを 1 名以上選択してください' });
		}

		try {
			const source = loadFromMarketplace('challenge-set', presetId);
			const result = await dispatchImport({
				typeCode: 'challenge-set',
				rawPayload: source.payload,
				displayName: source.displayName,
				ctx: { tenantId, presetId, childIds },
			});
			return {
				packName: result.packName,
				imported: result.imported,
				skipped: result.skipped,
				total: result.total,
				errors: result.errors,
				presetId,
			};
		} catch (e) {
			if (e instanceof Error && e.message.includes('not found in marketplace SSOT')) {
				return fail(404, { error: 'チャレンジ集が見つかりません' });
			}
			logger.error('[admin/challenges] importMarketplaceChallengeSet 失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { presetId, childCount: childIds.length },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},
};
