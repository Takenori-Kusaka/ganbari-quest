import { getActivityDisplayName } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	cancelActivityLog,
	getTodayRecordedActivityCounts,
	recordActivity,
} from '$lib/server/services/activity-log-service';
import { getActivities } from '$lib/server/services/activity-service';
import {
	HEALTH_CHECK_ITEMS,
	checkBirthdayStatus,
	submitBirthdayReview,
} from '$lib/server/services/birthday-service';
import { getChecklistsForChild } from '$lib/server/services/checklist-service';
import { getTodayMissions } from '$lib/server/services/daily-mission-service';
import { claimLoginBonus, getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import { getUnshownReward } from '$lib/server/services/special-reward-service';
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
			hasChecklists: false,
			checklistProgress: null,
			birthdayStatus: null,
			healthCheckItems: [],
			dailyMissions: null,
		};

	const rawActivities = await getActivities(tenantId, { childAge: child.age });
	const activities = rawActivities.map((a) => ({
		...a,
		displayName: getActivityDisplayName(a, child.age),
	}));
	const todayRecorded = await getTodayRecordedActivityCounts(child.id, tenantId);
	const loginBonusStatus = await getLoginBonusStatus(child.id, tenantId);
	const bonusStatus = 'error' in loginBonusStatus ? null : loginBonusStatus;

	// 未表示の特別報酬を取得
	const latestReward = await getUnshownReward(child.id, tenantId);

	// チェックリスト進捗
	const checklists = await getChecklistsForChild(child.id, todayDate(), tenantId);
	const hasChecklists = checklists.length > 0;
	const checklistProgress = hasChecklists
		? {
				checkedCount: checklists.reduce((sum, c) => sum + c.checkedCount, 0),
				totalCount: checklists.reduce((sum, c) => sum + c.totalCount, 0),
				allDone: checklists.every((c) => c.completedAll),
			}
		: null;

	// 誕生日ステータス
	const birthdayRaw = await checkBirthdayStatus(child.id, tenantId);
	const birthdayStatus = 'error' in birthdayRaw ? null : birthdayRaw;

	// デイリーミッション
	const dailyMissions = await getTodayMissions(child.id, tenantId);

	return {
		activities,
		todayRecorded,
		loginBonusStatus: bonusStatus,
		latestReward,
		hasChecklists,
		checklistProgress,
		birthdayStatus,
		healthCheckItems: HEALTH_CHECK_ITEMS.map((h) => ({ key: h.key, label: h.label, icon: h.icon })),
		dailyMissions,
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
};
