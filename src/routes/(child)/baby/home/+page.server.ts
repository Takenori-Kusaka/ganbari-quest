import { getActivityDisplayName } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	cancelActivityLog,
	getTodayRecordedActivityCounts,
	recordActivity,
} from '$lib/server/services/activity-log-service';
import { sortActivitiesWithPreferences } from '$lib/server/services/activity-pin-service';
import { getActivities } from '$lib/server/services/activity-service';
import {
	HEALTH_CHECK_ITEMS,
	checkBirthdayStatus,
	submitBirthdayReview,
} from '$lib/server/services/birthday-service';
import { getTodayMissions } from '$lib/server/services/daily-mission-service';
import { claimLoginBonus, getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import { getUnshownReward } from '$lib/server/services/special-reward-service';
import {
	getStampCardStatus,
	redeemStampCard,
	stampToday,
} from '$lib/server/services/stamp-card-service';
import { getCategoryXpSummary } from '$lib/server/services/status-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child)
		return {
			activities: [],
			todayRecorded: [],
			loginBonusStatus: null,
			latestReward: null,
			birthdayStatus: null,
			healthCheckItems: [],
			dailyMissions: null,
			stampCard: null,
			categoryXp: null,
		};

	// 独立したDB呼び出しを並列実行（LCP改善）
	const [
		rawActivities,
		todayRecorded,
		loginBonusStatus,
		latestReward,
		birthdayRaw,
		dailyMissions,
		stampCard,
		categoryXp,
	] = await Promise.all([
		getActivities(tenantId, { childAge: child.age }),
		getTodayRecordedActivityCounts(child.id, tenantId),
		getLoginBonusStatus(child.id, tenantId),
		getUnshownReward(child.id, tenantId),
		checkBirthdayStatus(child.id, tenantId),
		getTodayMissions(child.id, tenantId),
		getStampCardStatus(child.id, tenantId),
		getCategoryXpSummary(child.id, tenantId),
	]);

	const sortedActivities = await sortActivitiesWithPreferences(rawActivities, child.id, tenantId);
	const activities = sortedActivities.map((a) => ({
		...a,
		displayName: getActivityDisplayName(a, child.age),
	}));
	const bonusStatus = 'error' in loginBonusStatus ? null : loginBonusStatus;
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
		birthdayStatus,
		healthCheckItems: HEALTH_CHECK_ITEMS.map((h) => ({ key: h.key, label: h.label, icon: h.icon })),
		dailyMissions,
		stampCard,
		categoryXp,
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
