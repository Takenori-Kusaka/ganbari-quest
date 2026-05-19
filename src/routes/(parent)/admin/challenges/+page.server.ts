import { fail } from '@sveltejs/kit';
import { getMarketplaceItem } from '$lib/data/marketplace';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import type { ChallengeSetPayload } from '$lib/domain/marketplace-item';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import { getFamilyStreak, getNextMilestone } from '$lib/server/services/family-streak-service';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import {
	createSiblingChallenge,
	deleteSiblingChallenge,
	getAllChallengesWithProgress,
} from '$lib/server/services/sibling-challenge-service';
import type { Actions, PageServerLoad } from './$types';

/**
 * #2297 (EPIC #2294 ③): challenge-set 一括追加用ヘルパー
 *
 * preset の `monthDay` ('MM-DD') と `durationDays` から、現在年または翌年の
 * 実日付に展開する。monthDay が「今日より過去」なら来年の同月日とする
 * (例: 2026/05/19 時点で「03-03 ひな祭り」を import すると 2027/03/03 になる)。
 *
 * @internal export しているのは unit test 用
 */
export function expandChallengeSetDates(
	monthDay: string,
	durationDays: number,
	today: Date = new Date(),
): { startDate: string; endDate: string } {
	const [mm, dd] = monthDay.split('-').map(Number);
	if (!mm || !dd) {
		throw new Error(`Invalid monthDay format: ${monthDay} (expected MM-DD)`);
	}
	const year = today.getFullYear();
	// 候補 1: 今年の monthDay
	let endDate = new Date(Date.UTC(year, mm - 1, dd));
	const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
	// 既に過ぎていれば来年扱い
	if (endDate.getTime() < todayUTC.getTime()) {
		endDate = new Date(Date.UTC(year + 1, mm - 1, dd));
	}
	const startDate = new Date(endDate.getTime());
	startDate.setUTCDate(startDate.getUTCDate() - durationDays + 1);
	const fmt = (d: Date) => d.toISOString().slice(0, 10);
	return { startDate: fmt(startDate), endDate: fmt(endDate) };
}

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
		const challengeType = String(fd.get('challengeType') ?? 'cooperative');
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

	// #2297 (EPIC #2294 ③): マーケプレ challenge-set 一括 import
	importChallengeSet: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const presetId = String(fd.get('presetId') ?? '').trim();
		if (!presetId) return fail(400, { error: 'presetId が必要です' });

		const item = getMarketplaceItem('challenge-set', presetId);
		if (!item) return fail(404, { error: 'チャレンジ集が見つかりません' });

		const payload = item.payload as ChallengeSetPayload;
		const today = new Date();
		let imported = 0;
		const errors: string[] = [];

		for (const ch of payload.challenges) {
			try {
				const { startDate, endDate } = expandChallengeSetDates(ch.monthDay, ch.durationDays, today);
				const targetConfig = JSON.stringify({
					metric: 'count',
					baseTarget: ch.baseTarget,
					categoryId: ch.categoryId,
				});
				const rewardConfig = JSON.stringify({ points: ch.rewardPoints });
				await createSiblingChallenge(
					{
						title: ch.title,
						description: ch.description,
						challengeType: 'cooperative',
						periodType: 'custom',
						startDate,
						endDate,
						targetConfig,
						rewardConfig,
					},
					tenantId,
				);
				imported++;
			} catch (e) {
				errors.push(`${ch.title}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		return {
			challengeSetImport: {
				presetName: item.name,
				imported,
				errors,
			},
		};
	},
};
