import { getActivityDisplayName } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAchievementSummary } from '$lib/server/services/achievement-service';
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
	HEALTH_CHECK_ITEMS,
	checkBirthdayStatus,
	submitBirthdayReview,
} from '$lib/server/services/birthday-service';
import { getChecklistsForChild } from '$lib/server/services/checklist-service';
import { getTodayMissions } from '$lib/server/services/daily-mission-service';
import { claimLoginBonus, getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import { getUnshownMessage } from '$lib/server/services/message-service';
import { getSkillPointBalance } from '$lib/server/services/skill-service';
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
	const { child } = await parent();
	if (!child)
		return {
			activities: [],
			todayRecorded: [],
			loginBonusStatus: null,
			latestReward: null,
			latestMessage: null,
			hasChecklists: false,
			checklistProgress: null,
			birthdayStatus: null,
			healthCheckItems: [],
			dailyMissions: null,
			stampCard: null,
			categoryXp: null,
			gameLoopHints: null,
		};

	// 独立したDB呼び出しを並列実行（LCP改善）
	const [
		rawActivities,
		todayRecorded,
		loginBonusStatus,
		latestReward,
		latestMessage,
		checklists,
		birthdayRaw,
		dailyMissions,
		stampCard,
		categoryXp,
		achievementSummary,
		spBalance,
		hasRecords,
	] = await Promise.all([
		getActivities(tenantId, { childAge: child.age }),
		getTodayRecordedActivityCounts(child.id, tenantId),
		getLoginBonusStatus(child.id, tenantId),
		getUnshownReward(child.id, tenantId),
		getUnshownMessage(child.id, tenantId),
		getChecklistsForChild(child.id, todayDate(), tenantId),
		checkBirthdayStatus(child.id, tenantId),
		getTodayMissions(child.id, tenantId),
		getStampCardStatus(child.id, tenantId),
		getCategoryXpSummary(child.id, tenantId),
		getAchievementSummary(child.id, tenantId),
		getSkillPointBalance(child.id, tenantId),
		hasAnyActivityRecords(child.id, tenantId),
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
	const birthdayStatus = 'error' in birthdayRaw ? null : birthdayRaw;

	// ミッション対象の活動IDセット
	const missionActivityIds = new Set(dailyMissions?.missions.map((m) => m.activityId) ?? []);

	// activitiesにisMissionフラグを付与
	const activitiesWithMission = activities.map((a) => ({
		...a,
		isMission: missionActivityIds.has(a.id),
	}));

	return {
		activities: activitiesWithMission,
		todayRecorded,
		loginBonusStatus: bonusStatus,
		latestReward,
		latestMessage: latestMessage ?? null,
		hasChecklists,
		checklistProgress,
		birthdayStatus,
		healthCheckItems: HEALTH_CHECK_ITEMS.map((h) => ({ key: h.key, label: h.label, icon: h.icon })),
		dailyMissions,
		stampCard,
		categoryXp,
		gameLoopHints: {
			achievements: achievementSummary,
			spBalance: spBalance.balance,
		},
		isFirstTime: !hasRecords,
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
			unlockedAchievements: result.unlockedAchievements,
			comboBonus: result.comboBonus,
			missionComplete: result.missionComplete,
			levelUp: result.levelUp,
			masteryBonus: result.masteryBonus,
			masteryLevel: result.masteryLevel,
			masteryLeveledUp: result.masteryLeveledUp,
			skillPointBonus: result.skillPointBonus,
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

	submitBirthday: async ({ request, cookies, locals }) => {
		const tenantId = requireTenantId(locals);
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const formData = await request.formData();
		const healthChecksJson = formData.get('healthChecks') as string;
		const aspirationText = (formData.get('aspirationText') as string) || '';

		let healthChecks: Record<string, boolean> = {};
		try {
			healthChecks = JSON.parse(healthChecksJson);
		} catch {
			return fail(400, { error: 'データが不正です' });
		}

		const result = await submitBirthdayReview(childId, { healthChecks, aspirationText }, tenantId);
		if ('error' in result) {
			if (result.error === 'ALREADY_REVIEWED') {
				return fail(409, { error: 'もうふりかえりしたよ！' });
			}
			return fail(404, { error: 'みつかりません' });
		}

		return {
			success: true,
			birthdayReview: true,
			basePoints: result.basePoints,
			healthPoints: result.healthPoints,
			aspirationPoints: result.aspirationPoints,
			totalPoints: result.totalPoints,
		};
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

		// 2. Stamp the card
		const stampResult = await stampToday(childId, tenantId);
		const stamp = 'error' in stampResult ? null : stampResult;

		if (!bonus && !stamp) {
			return fail(409, { error: 'きょうはもうスタンプをおしたよ！' });
		}

		return {
			success: true,
			loginStamp: true,
			stampEmoji: stamp?.stamp.emoji ?? '⭐',
			stampRarity: stamp?.stamp.rarity ?? 'N',
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
};
