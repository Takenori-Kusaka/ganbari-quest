import { fail } from '@sveltejs/kit';
import { getMarketplaceItem } from '$lib/data/marketplace';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import type { ChallengeSetPayload } from '$lib/domain/marketplace-item';
// #2369 (EPIC #2362 P3 / ADR-0052): challenge-set を新 Strategy + dispatchImport 経由に移行。
// `$lib/marketplace` の eager-load (`./types/challenge-set`) で Registry 登録される。
import { dispatchImport } from '$lib/marketplace';
import { loadFromMarketplace } from '$lib/marketplace/sources/marketplace-source';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import { getFamilyStreak, getNextMilestone } from '$lib/server/services/family-streak-service';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import {
	createSiblingChallenge,
	deleteSiblingChallenge,
	getAllChallengesWithProgress,
} from '$lib/server/services/sibling-challenge-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const planTier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);

	const [challenges, children, familyStreakData] = await Promise.all([
		getAllChallengesWithProgress(tenantId),
		getAllChildren(tenantId),
		getFamilyStreak(tenantId),
	]);

	const familyStreak = {
		...familyStreakData,
		nextMilestone: getNextMilestone(familyStreakData.currentStreak),
	};

	// #2297 (EPIC #2294 ③): marketplace-import=<presetId> query param で
	// マーケプレ challenge-set を一括追加できるよう、preview 情報を pre-fill 候補として返す
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

	return { challenges, children, planTier, familyStreak, marketplaceImport };
};

export const actions: Actions = {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
	create: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const title = String(fd.get('title') ?? '').trim();
		const description = String(fd.get('description') ?? '').trim() || null;
		// #2296 (EPIC #2294 ②): 新規作成は cooperative 固定 (2026-05-19)
		// Research §3.2: 兄弟競争は Harvard Health で depression/自傷リスク 2 倍。
		// 既存 competitive データは UI 表示のみ可、サーバー側でも防衛的に強制。
		const challengeType = 'cooperative';
		const periodType = String(fd.get('periodType') ?? 'weekly');
		const startDate = String(fd.get('startDate') ?? '');
		const endDate = String(fd.get('endDate') ?? '');

		// ターゲット設定
		const metric = String(fd.get('metric') ?? 'count');
		const baseTarget = Number(fd.get('baseTarget') ?? 3);
		const categoryIdStr = String(fd.get('categoryId') ?? '');
		const categoryId = categoryIdStr ? Number(categoryIdStr) : undefined;

		// 報酬設定
		const rewardPoints = Number(fd.get('rewardPoints') ?? 50);
		const rewardMessage = String(fd.get('rewardMessage') ?? '').trim() || undefined;

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
			await createSiblingChallenge(
				{
					title,
					description,
					challengeType,
					periodType,
					startDate,
					endDate,
					targetConfig,
					rewardConfig,
				},
				tenantId,
			);
			return { created: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'チャレンジ作成に失敗しました' });
		}
	},

	delete: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!id) return fail(400, { error: 'IDが不正です' });

		await deleteSiblingChallenge(id, tenantId);
		return { deleted: true };
	},

	// #2297 (EPIC #2294 ③) / #2369 (EPIC #2362 P3): マーケプレ challenge-set 一括 import
	// 旧来 `+page.server.ts` 内で createSiblingChallenge を直接ループ呼出していたが、
	// ADR-0052 に従い Strategy + dispatchImport 経由に移行 (#2369)。
	importChallengeSet: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const presetId = String(fd.get('presetId') ?? '').trim();
		if (!presetId) return fail(400, { error: 'presetId が必要です' });

		// #2369: Strategy + dispatchImport 経由
		try {
			const source = loadFromMarketplace('challenge-set', presetId);
			const result = await dispatchImport({
				typeCode: 'challenge-set',
				rawPayload: source.payload,
				displayName: source.displayName,
				ctx: { tenantId, presetId },
			});
			return {
				challengeSetImport: {
					presetName: result.packName,
					imported: result.imported,
					skipped: result.skipped,
					errors: result.errors,
				},
			};
		} catch (e) {
			if (e instanceof Error && e.message.includes('not found in marketplace SSOT')) {
				return fail(404, { error: 'チャレンジ集が見つかりません' });
			}
			logger.error('[admin/challenges] challenge-set インポート失敗', {
				error: e instanceof Error ? e.message : String(e),
				context: { presetId },
			});
			return fail(500, { error: 'インポートに失敗しました' });
		}
	},
};
