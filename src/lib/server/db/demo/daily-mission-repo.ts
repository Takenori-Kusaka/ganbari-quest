import { prevDateJST } from '$lib/domain/date-utils';
import type { ActivityId, ChildId } from '$lib/domain/ids';
// Demo IDailyMissionRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import {
	DEMO_ACTIVITIES,
	DEMO_ACTIVITY_LOGS,
	DEMO_CHILDREN,
	DEMO_DAILY_MISSIONS,
} from '$lib/server/demo/demo-data';
import type { Activity, Child, DailyMissionWithActivity } from '../types';

export async function findTodayMissions(
	childId: ChildId,
	date: string,
	_tenantId: string,
): Promise<DailyMissionWithActivity[]> {
	return DEMO_DAILY_MISSIONS.filter((m) => m.childId === childId && m.missionDate === date)
		.map((m) => {
			const activity = DEMO_ACTIVITIES.find((a) => a.id === m.activityId);
			return activity
				? ({
						id: m.id,
						activityId: m.activityId,
						completed: m.completed,
						activityName: activity.name,
						activityIcon: activity.icon,
						categoryId: activity.categoryId,
					} satisfies DailyMissionWithActivity)
				: null;
		})
		.filter((x): x is DailyMissionWithActivity => x !== null);
}

export async function findMissionBonusRecord(
	_childId: ChildId,
	_description: string,
	_tenantId: string,
): Promise<{ amount: number } | undefined> {
	return undefined;
}

export async function findMissionByActivity(
	childId: ChildId,
	date: string,
	activityId: ActivityId,
	_tenantId: string,
): Promise<{ id: string; completed: number } | undefined> {
	const mission = DEMO_DAILY_MISSIONS.find(
		(m) => m.childId === childId && m.missionDate === date && m.activityId === activityId,
	);
	return mission ? { id: mission.id, completed: mission.completed } : undefined;
}

export async function markMissionCompleted(
	_childId: ChildId,
	_date: string,
	_activityId: ActivityId,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function markMissionUncompleted(
	_childId: ChildId,
	_date: string,
	_activityId: ActivityId,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function findAllMissionStatuses(
	childId: ChildId,
	date: string,
	_tenantId: string,
): Promise<{ completed: number }[]> {
	return DEMO_DAILY_MISSIONS.filter((m) => m.childId === childId && m.missionDate === date).map(
		(m) => ({ completed: m.completed }),
	);
}

export async function findChildForMission(
	childId: ChildId,
	_tenantId: string,
): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === childId);
}

export async function findVisibleActivities(_tenantId: string): Promise<Activity[]> {
	return DEMO_ACTIVITIES.filter((a) => a.isVisible === 1);
}

export async function findPreviousDayMissionIds(
	childId: ChildId,
	date: string,
	_tenantId: string,
): Promise<ActivityId[]> {
	const prevDate = prevDateJST(date);
	return DEMO_DAILY_MISSIONS.filter((m) => m.childId === childId && m.missionDate === prevDate).map(
		(m) => m.activityId,
	);
}

export async function findRecentActivityIds(
	childId: ChildId,
	sinceDate: string,
	_tenantId: string,
): Promise<ActivityId[]> {
	const ids = new Set<ActivityId>();
	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.childId === childId && log.recordedDate >= sinceDate && log.cancelled === 0) {
			ids.add(log.activityId);
		}
	}
	return Array.from(ids);
}

export async function findAllRecordedActivityIds(
	childId: ChildId,
	_tenantId: string,
): Promise<ActivityId[]> {
	const ids = new Set<ActivityId>();
	for (const log of DEMO_ACTIVITY_LOGS) {
		if (log.childId === childId && log.cancelled === 0) ids.add(log.activityId);
	}
	return Array.from(ids);
}

export async function insertDailyMission(
	_childId: ChildId,
	_date: string,
	_activityId: ActivityId,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
