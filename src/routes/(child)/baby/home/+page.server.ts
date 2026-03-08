import {
	cancelActivityLog,
	getTodayRecordedActivityCounts,
	recordActivity,
} from '$lib/server/services/activity-log-service';
import { getActivities } from '$lib/server/services/activity-service';
import { checkBirthdayStatus, submitBirthdayReview, HEALTH_CHECK_ITEMS } from '$lib/server/services/birthday-service';
import { claimLoginBonus, getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import { getTodayMissions } from '$lib/server/services/daily-mission-service';
import { getChildSpecialRewards } from '$lib/server/services/special-reward-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
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
		};

	const activities = getActivities({ childAge: child.age });
	const todayRecorded = getTodayRecordedActivityCounts(child.id);
	const loginBonusStatus = getLoginBonusStatus(child.id);
	const bonusStatus = 'error' in loginBonusStatus ? null : loginBonusStatus;

	const rewardResult = getChildSpecialRewards(child.id);
	const latestReward = rewardResult.rewards.length > 0 ? (rewardResult.rewards[0] ?? null) : null;

	// 誕生日ステータス
	const birthdayRaw = checkBirthdayStatus(child.id);
	const birthdayStatus = 'error' in birthdayRaw ? null : birthdayRaw;

	// デイリーミッション
	const dailyMissions = getTodayMissions(child.id);

	return {
		activities,
		todayRecorded,
		loginBonusStatus: bonusStatus,
		latestReward,
		birthdayStatus,
		healthCheckItems: HEALTH_CHECK_ITEMS.map((h) => ({ key: h.key, label: h.label, icon: h.icon })),
		dailyMissions,
	};
};

export const actions: Actions = {
	record: async ({ request, cookies }) => {
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const activityId = Number(formData.get('activityId'));

		if (Number.isNaN(childId) || Number.isNaN(activityId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = recordActivity(childId, activityId);
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
		};
	},

	cancelRecord: async ({ request, cookies }) => {
		const formData = await request.formData();
		const childId = Number(cookies.get('selectedChildId'));
		const logId = Number(formData.get('logId'));

		if (Number.isNaN(childId) || Number.isNaN(logId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = cancelActivityLog(logId);
		if ('error' in result) {
			if (result.error === 'CANCEL_EXPIRED') {
				return fail(410, { error: 'とりけしできません' });
			}
			return fail(404, { error: 'みつかりません' });
		}

		return { success: true, cancelled: true, refundedPoints: result.refundedPoints };
	},

	submitBirthday: async ({ request, cookies }) => {
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

		const result = submitBirthdayReview(childId, { healthChecks, aspirationText });
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

	claimBonus: async ({ cookies }) => {
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = claimLoginBonus(childId);
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
};
