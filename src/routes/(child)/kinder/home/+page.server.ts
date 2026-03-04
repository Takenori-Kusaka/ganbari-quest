import {
	cancelActivityLog,
	getTodayRecordedActivityCounts,
	recordActivity,
} from '$lib/server/services/activity-log-service';
import { getActivities } from '$lib/server/services/activity-service';
import { getChecklistsForChild } from '$lib/server/services/checklist-service';
import { claimLoginBonus, getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import { getChildSpecialRewards } from '$lib/server/services/special-reward-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

function todayDate(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child)
		return {
			activities: [],
			todayRecorded: [],
			loginBonusStatus: null,
			latestReward: null,
			hasChecklists: false,
			checklistProgress: null,
		};

	const activities = getActivities({ childAge: child.age });
	const todayRecorded = getTodayRecordedActivityCounts(child.id);
	const loginBonusStatus = getLoginBonusStatus(child.id);
	const bonusStatus = 'error' in loginBonusStatus ? null : loginBonusStatus;

	// 最新の特別報酬（直近1件）を取得
	const rewardResult = getChildSpecialRewards(child.id);
	const latestReward = rewardResult.rewards.length > 0 ? (rewardResult.rewards[0] ?? null) : null;

	// チェックリスト進捗
	const checklists = getChecklistsForChild(child.id, todayDate());
	const hasChecklists = checklists.length > 0;
	const checklistProgress = hasChecklists
		? {
				checkedCount: checklists.reduce((sum, c) => sum + c.checkedCount, 0),
				totalCount: checklists.reduce((sum, c) => sum + c.totalCount, 0),
				allDone: checklists.every((c) => c.completedAll),
			}
		: null;

	return {
		activities,
		todayRecorded,
		loginBonusStatus: bonusStatus,
		latestReward,
		hasChecklists,
		checklistProgress,
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
				return fail(410, { error: 'とりけしじかんがすぎたよ' });
			}
			return fail(404, { error: 'みつかりません' });
		}

		return { success: true, cancelled: true, refundedPoints: result.refundedPoints };
	},

	claimBonus: async ({ cookies }) => {
		const childId = Number(cookies.get('selectedChildId'));
		if (Number.isNaN(childId)) {
			return fail(400, { error: 'パラメータが不正です' });
		}

		const result = claimLoginBonus(childId);
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
};
