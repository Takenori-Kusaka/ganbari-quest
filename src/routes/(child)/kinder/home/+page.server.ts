import { getActivityDisplayName } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	cancelActivityLog,
	getTodayRecordedActivityCounts,
	hasAnyActivityRecords,
	recordActivity,
} from '$lib/server/services/activity-log-service';
import { sortActivitiesWithPreferences } from '$lib/server/services/activity-pin-service';
import { toggleActivityPin } from '$lib/server/services/activity-pin-service';
import { getActivities } from '$lib/server/services/activity-service';
import {
	claimBirthdayBonus,
	getBirthdayBonusStatus,
} from '$lib/server/services/birthday-bonus-service';
import { getChecklistsForChild } from '$lib/server/services/checklist-service';
import { getTodayMissions } from '$lib/server/services/daily-mission-service';
import { getFamilyStreak, getNextMilestone } from '$lib/server/services/family-streak-service';
import { claimLoginBonus, getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import { getUnshownMessage } from '$lib/server/services/message-service';
import { selectRecommendations } from '$lib/server/services/recommendation-service';
import {
	claimEventReward,
	getActiveEventsForChild,
} from '$lib/server/services/season-event-service';
import { getMonthlyPremiumReward } from '$lib/server/services/seasonal-content-service';
import {
	claimChallengeReward as claimChallengeRewardService,
	getActiveChallengesForChild,
} from '$lib/server/services/sibling-challenge-service';
import {
	getUnshownCheers,
	markCheersShown,
	sendCheer,
} from '$lib/server/services/sibling-cheer-service';
import { getWeeklyRanking, isRankingEnabled } from '$lib/server/services/sibling-ranking-service';
import {
	getSpecialRewardProgress,
	getUnshownReward,
} from '$lib/server/services/special-reward-service';
import {
	getStampCardStatus,
	redeemStampCard,
	stampToday,
} from '$lib/server/services/stamp-card-service';
import { getCategoryXpSummary } from '$lib/server/services/status-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

function todayDate(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const parentData = await parent();
	const { child } = parentData;
	if (!child)
		return {
			activities: [],
			todayRecorded: [],
			loginBonusStatus: null,
			latestReward: null,
			latestMessage: null,
			hasChecklists: false,
			checklistProgress: null,
			dailyMissions: null,
			stampCard: null,
			categoryXp: null,
			gameLoopHints: null,
			focusMode: false,
			recommendedActivityIds: [],
			birthdayBonus: null,
			activeEvents: [],
			activeChallenges: [],
			siblingRanking: null,
			unshownCheers: [],
			monthlyPremiumReward: null,
			specialRewardProgress: null,
		};

	// 独立したDB呼び出しを並列実行（LCP改善）
	const [
		rawActivities,
		todayRecorded,
		loginBonusStatus,
		latestReward,
		latestMessage,
		checklists,
		dailyMissions,
		stampCard,
		categoryXp,
		hasRecords,
		birthdayBonusStatus,
		activeEvents,
		activeChallenges,
		unshownCheers,
		familyStreakData,
		specialRewardProgress,
	] = await Promise.all([
		getActivities(tenantId, { childAge: child.age }),
		getTodayRecordedActivityCounts(child.id, tenantId),
		getLoginBonusStatus(child.id, tenantId),
		getUnshownReward(child.id, tenantId),
		getUnshownMessage(child.id, tenantId),
		getChecklistsForChild(child.id, todayDate(), tenantId),
		getTodayMissions(child.id, tenantId),
		getStampCardStatus(child.id, tenantId),
		getCategoryXpSummary(child.id, tenantId),
		hasAnyActivityRecords(child.id, tenantId),
		getBirthdayBonusStatus(child.id, tenantId),
		getActiveEventsForChild(child.id, tenantId),
		getActiveChallengesForChild(child.id, tenantId),
		getUnshownCheers(child.id, tenantId),
		getFamilyStreak(tenantId),
		getSpecialRewardProgress(child.id, tenantId),
	]);

	const sortedActivities = await sortActivitiesWithPreferences(rawActivities, child.id, tenantId);
	const activities = sortedActivities.map((a) => ({
		...a,
		displayName: getActivityDisplayName(a, child.age),
	}));
	const bonusStatus = 'error' in loginBonusStatus ? null : loginBonusStatus;
	const hasChecklists = checklists.length > 0;
	const checklistProgress = hasChecklists
		? {
				checkedCount: checklists.reduce((sum, c) => sum + c.checkedCount, 0),
				totalCount: checklists.reduce((sum, c) => sum + c.totalCount, 0),
				allDone: checklists.every((c) => c.completedAll),
			}
		: null;
	// ミッション対象の活動IDセット
	const missionActivityIds = new Set(dailyMissions?.missions.map((m) => m.activityId) ?? []);

	// activitiesにisMissionフラグを付与
	const activitiesWithMission = activities.map((a) => ({
		...a,
		isMission: missionActivityIds.has(a.id),
	}));

	// フォーカスモード: おすすめ活動の選定 (#0264)
	const recommendations = selectRecommendations(rawActivities, todayDate());
	const recommendedIds = new Set(recommendations.map((r) => r.activityId));

	const birthdayBonus =
		'error' in birthdayBonusStatus
			? null
			: birthdayBonusStatus.eligible
				? birthdayBonusStatus
				: null;

	// きょうだいランキング（設定有効時のみ）
	let siblingRanking: Awaited<ReturnType<typeof getWeeklyRanking>> | null = null;
	try {
		const rankingOn = await isRankingEnabled(tenantId);
		if (rankingOn) {
			siblingRanking = await getWeeklyRanking(tenantId);
		}
	} catch {
		// ランキング取得失敗はページ全体に影響させない
	}

	return {
		activities: activitiesWithMission,
		todayRecorded,
		loginBonusStatus: bonusStatus,
		latestReward,
		latestMessage: latestMessage ?? null,
		hasChecklists,
		checklistProgress,
		dailyMissions,
		stampCard,
		categoryXp,
		gameLoopHints: null,
		isFirstTime: !hasRecords,
		focusMode: recommendations.length > 0,
		recommendedActivityIds: [...recommendedIds],
		birthdayBonus,
		activeEvents,
		activeChallenges,
		siblingRanking,
		unshownCheers,
		familyStreak: familyStreakData
			? {
					...familyStreakData,
					nextMilestone: getNextMilestone(familyStreakData.currentStreak),
				}
			: null,
		monthlyPremiumReward: await getMonthlyPremiumReward(
			child.id,
			tenantId,
			parentData.isPremium ?? false,
		).catch(() => null),
		specialRewardProgress,
	};
};

export const actions: Actions = {
	record: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const activityId = Number(formData.get('activityId'));

		if (Number.isNaN(childId) || Number.isNaN(activityId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = await recordActivity(childId, activityId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_RECORDED') {
				return fail(409, { error: 'きょうはもうきろくしたよ！' });
			}
			if (result.error === 'DAILY_LIMIT_REACHED') {
				return fail(409, { error: 'きょうはこれいじょうきろくできないよ' });
			}
			return fail(404, { error: 'みつかりません' });
		}

		return {
			success: true,
			logId: result.id,
			activityName: result.activityName,
			totalPoints: result.totalPoints,
			streakDays: result.streakDays,
			streakBonus: result.streakBonus,
			cancelableUntil: result.cancelableUntil,
			comboBonus: result.comboBonus,
			missionComplete: result.missionComplete,
			eventMissions: result.eventMissions,
			focusBonus: result.focusBonus,
			levelUp: result.levelUp,
			masteryBonus: result.masteryBonus,
			masteryLevel: result.masteryLevel,
			masteryLeveledUp: result.masteryLeveledUp,
			xpGain: result.xpGain,
		};
	},

	cancelRecord: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const logId = Number(formData.get('logId'));

		if (Number.isNaN(childId) || Number.isNaN(logId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = await cancelActivityLog(logId, tenantId);
		if ('error' in result) {
			if (result.error === 'CANCEL_EXPIRED') {
				return fail(410, { error: 'とりけしじかんがすぎたよ' });
			}
			return fail(404, { error: 'みつかりません' });
		}

		return { success: true, cancelled: true, refundedPoints: result.refundedPoints };
	},

	claimBonus: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = await claimLoginBonus(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_CLAIMED') {
				return fail(409, { error: 'きょうのボーナスはもうもらったよ！' });
			}
			return fail(404, { error: 'みつかりません' });
		}

		return {
			success: true,
			bonusClaimed: true,
			rank: result.rank,
			basePoints: result.basePoints,
			multiplier: result.multiplier,
			totalPoints: result.totalPoints,
			consecutiveLoginDays: result.consecutiveLoginDays,
		};
	},

	/** Unified login stamp: claims bonus + stamps card in one action */
	loginStamp: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) return fail(400, { error: 'パラメータが不正です' });

		// 1. Claim login bonus (points + rank)
		const bonusResult = await claimLoginBonus(childId, tenantId);
		const bonus = 'error' in bonusResult ? null : bonusResult;

		// 2. Stamp the card (pass omikuji rank for integration)
		const stampResult = await stampToday(childId, tenantId, bonus?.rank);
		const stamp = 'error' in stampResult ? null : stampResult;

		if (!bonus && !stamp) {
			return fail(409, { error: 'きょうはもうスタンプをおしたよ！' });
		}

		return {
			success: true,
			loginStamp: true,
			stampEmoji: stamp?.stamp.emoji ?? '⭐',
			stampRarity: stamp?.stamp.rarity ?? 'N',
			stampName: stamp?.stamp.name ?? '',
			omikujiRank: bonus?.rank ?? stamp?.stamp.omikujiRank ?? null,
			totalPoints: bonus?.totalPoints ?? 0,
			multiplier: bonus?.multiplier ?? 1,
			consecutiveLoginDays: bonus?.consecutiveLoginDays ?? 0,
		};
	},

	togglePin: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const activityId = Number(formData.get('activityId'));
		const pinned = formData.get('pinned') === 'true';

		if (Number.isNaN(childId) || Number.isNaN(activityId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		try {
			const result = await toggleActivityPin(childId, activityId, pinned, tenantId);
			return { success: true, isPinned: result.isPinned };
		} catch (err) {
			const message = err instanceof Error ? err.message : 'ピン留めに失敗しました';
			return fail(400, { error: message });
		}
	},

	stampCard: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) return fail(400, { error: 'パラメータが不正です' });

		const result = await stampToday(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_STAMPED') return fail(409, { error: 'きょうはもうおしたよ' });
			if (result.error === 'CARD_FULL') return fail(409, { error: 'カードがいっぱいだよ' });
			return fail(400, { error: 'スタンプをおせませんでした' });
		}

		return {
			success: true,
			stampEmoji: result.stamp.emoji,
			stampName: result.stamp.name,
			stampRarity: result.stamp.rarity,
			omikujiRank: result.stamp.omikujiRank ?? null,
		};
	},

	redeemStampCard: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) return fail(400, { error: 'パラメータが不正です' });

		const result = await redeemStampCard(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_REDEEMED') return fail(409, { error: 'もうこうかんしたよ' });
			if (result.error === 'EMPTY_CARD') return fail(400, { error: 'スタンプがないよ' });
			return fail(400, { error: 'こうかんできませんでした' });
		}

		return {
			success: true,
			totalPoints: result.points,
			stampPoints: result.stampPoints,
			completeBonus: result.completeBonus,
		};
	},

	claimBirthday: async ({ cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) return fail(400, { error: 'パラメータが不正です' });

		const result = await claimBirthdayBonus(childId, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_CLAIMED') return fail(409, { error: 'もうもらったよ' });
			if (result.error === 'NOT_ELIGIBLE')
				return fail(400, { error: 'おたんじょうびボーナスはありません' });
			return fail(400, { error: 'ボーナスをもらえませんでした' });
		}

		return {
			success: true,
			birthdayClaimed: true,
			newAge: result.newAge,
			totalPoints: result.totalPoints,
			multiplier: result.multiplier,
		};
	},

	claimEventReward: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const eventId = Number(formData.get('eventId'));

		if (Number.isNaN(childId) || Number.isNaN(eventId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		try {
			const result = await claimEventReward(childId, eventId, tenantId);
			let rewardInfo: { points?: number; title?: string } = {};
			if (result.rewardConfig) {
				try {
					rewardInfo = JSON.parse(result.rewardConfig);
				} catch {
					/* ignore */
				}
			}
			return {
				success: true,
				eventRewardClaimed: true,
				rewardPoints: rewardInfo.points ?? 0,
				rewardTitle: rewardInfo.title ?? '',
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : 'ほうしゅうをうけとれませんでした';
			return fail(400, { error: message });
		}
	},

	claimChallengeReward: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const challengeId = Number(formData.get('challengeId'));

		if (Number.isNaN(childId) || Number.isNaN(challengeId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		try {
			const result = await claimChallengeRewardService(challengeId, childId, tenantId);
			if ('error' in result) {
				return fail(400, { error: result.error });
			}
			return {
				success: true,
				challengeRewardClaimed: true,
				rewardPoints: result.points,
				rewardMessage: result.message ?? '',
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : 'ほうしゅうをうけとれませんでした';
			return fail(400, { error: message });
		}
	},

	sendCheer: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const toChildId = Number(formData.get('toChildId'));
		const stampCode = formData.get('stampCode')?.toString() ?? '';

		if (Number.isNaN(childId) || Number.isNaN(toChildId) || !stampCode) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = await sendCheer(childId, toChildId, stampCode, tenantId);
		if ('error' in result) {
			return fail(400, { error: result.error });
		}

		return { success: true, cheerSent: true };
	},

	markCheersShown: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const cheerIdsStr = formData.get('cheerIds')?.toString() ?? '';
		const cheerIds = cheerIdsStr
			.split(',')
			.map(Number)
			.filter((n) => !Number.isNaN(n));

		if (cheerIds.length === 0) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		await markCheersShown(cheerIds, tenantId);
		return { success: true };
	},

	claimMonthlyReward: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const eventId = Number(formData.get('eventId'));

		if (Number.isNaN(childId) || Number.isNaN(eventId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		try {
			const { claimMonthlyPremiumReward } = await import(
				'$lib/server/services/seasonal-content-service'
			);
			const { isPaidTier, resolveFullPlanTier } = await import(
				'$lib/server/services/plan-limit-service'
			);
			const isPremium = isPaidTier(
				await resolveFullPlanTier(
					tenantId,
					locals.context?.licenseStatus ?? 'none',
					locals.context?.plan,
				),
			);
			const reward = await claimMonthlyPremiumReward(childId, eventId, tenantId, isPremium);
			return { claimedReward: reward };
		} catch {
			return fail(500, { error: '月替わり報酬の受け取りに失敗しました' });
		}
	},
};
