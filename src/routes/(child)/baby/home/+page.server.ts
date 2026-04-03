import { getActivityDisplayName } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAchievementSummary } from '$lib/server/services/achievement-service';
import {
	cancelActivityLog,
	getTodayRecordedActivityCounts,
	recordActivity,
} from '$lib/server/services/activity-log-service';
import { sortActivitiesWithPreferences } from '$lib/server/services/activity-pin-service';
import { getActivities } from '$lib/server/services/activity-service';
import {
	claimBirthdayBonus,
	getBirthdayBonusStatus,
} from '$lib/server/services/birthday-bonus-service';
import { getTodayMissions } from '$lib/server/services/daily-mission-service';
import { claimLoginBonus, getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import { selectRecommendations } from '$lib/server/services/recommendation-service';
import {
	getMonthlyPremiumReward,
	getSeasonPassForChild,
} from '$lib/server/services/seasonal-content-service';
import { getUnshownReward } from '$lib/server/services/special-reward-service';
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
			dailyMissions: null,
			stampCard: null,
			categoryXp: null,
			gameLoopHints: null,
			focusMode: false,
			recommendedActivityIds: [],
			birthdayBonus: null,
			seasonPass: null,
			monthlyPremiumReward: null,
		};

	// 独立したDB呼び出しを並列実行（LCP改善）
	const [
		rawActivities,
		todayRecorded,
		loginBonusStatus,
		latestReward,
		dailyMissions,
		stampCard,
		categoryXp,
		achievementSummary,
		birthdayBonusStatus,
	] = await Promise.all([
		getActivities(tenantId, { childAge: child.age }),
		getTodayRecordedActivityCounts(child.id, tenantId),
		getLoginBonusStatus(child.id, tenantId),
		getUnshownReward(child.id, tenantId),
		getTodayMissions(child.id, tenantId),
		getStampCardStatus(child.id, tenantId),
		getCategoryXpSummary(child.id, tenantId),
		getAchievementSummary(child.id, tenantId),
		getBirthdayBonusStatus(child.id, tenantId),
	]);

	const sortedActivities = await sortActivitiesWithPreferences(rawActivities, child.id, tenantId);
	const activities = sortedActivities.map((a) => ({
		...a,
		displayName: getActivityDisplayName(a, child.age),
	}));
	const bonusStatus = 'error' in loginBonusStatus ? null : loginBonusStatus;

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

	return {
		activities: activitiesWithMission,
		todayRecorded,
		loginBonusStatus: bonusStatus,
		latestReward,
		dailyMissions,
		stampCard,
		categoryXp,
		gameLoopHints: {
			achievements: achievementSummary,
		},
		focusMode: recommendations.length > 0,
		recommendedActivityIds: [...recommendedIds],
		birthdayBonus,
		seasonPass: await getSeasonPassForChild(
			child.id,
			tenantId,
			parentData.isPremium ?? false,
		).catch(() => null),
		monthlyPremiumReward: await getMonthlyPremiumReward(
			child.id,
			tenantId,
			parentData.isPremium ?? false,
		).catch(() => null),
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
				return fail(409, { error: 'もうきろくしたよ' });
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
			activityIcon: '',
			totalPoints: result.totalPoints,
			streakDays: result.streakDays,
			streakBonus: result.streakBonus,
			cancelableUntil: result.cancelableUntil,
			unlockedAchievements: result.unlockedAchievements,
			comboBonus: result.comboBonus,
			missionComplete: result.missionComplete,
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
				return fail(410, { error: 'とりけしできません' });
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
				return fail(409, { error: 'もうもらったよ' });
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

		const bonusResult = await claimLoginBonus(childId, tenantId);
		const bonus = 'error' in bonusResult ? null : bonusResult;

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

	claimSeasonPassReward: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const eventId = Number(formData.get('eventId'));
		const target = Number(formData.get('target'));
		const track = String(formData.get('track'));

		if (Number.isNaN(childId) || Number.isNaN(eventId) || Number.isNaN(target)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		try {
			const { claimSeasonPassMilestone } = await import(
				'$lib/server/services/seasonal-content-service'
			);
			const reward = await claimSeasonPassMilestone(childId, eventId, target, track, tenantId);
			return { claimedReward: reward };
		} catch {
			return fail(500, { error: 'マイルストーン報酬の受け取りに失敗しました' });
		}
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
