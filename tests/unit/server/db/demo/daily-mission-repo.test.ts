// tests/unit/server/db/demo/daily-mission-repo.test.ts

import { describe, expect, it } from 'vitest';
import * as dailyMissionRepo from '../../../../../src/lib/server/db/demo/daily-mission-repo';
import {
	DEMO_DAILY_MISSIONS,
} from '../../../../../src/lib/server/demo/demo-data';

describe('demo/daily-mission-repo', () => {
	it('findTodayMissions は当該日 + child のミッションを返し、activityName/activityIcon を含む', async () => {
		const sample = DEMO_DAILY_MISSIONS[0];
		expect(sample).toBeDefined();
		if (!sample) return;
		const missions = await dailyMissionRepo.findTodayMissions(
			sample.childId,
			sample.missionDate,
			'demo',
		);
		expect(missions.length).toBeGreaterThan(0);
		expect(missions[0]).toHaveProperty('activityName');
		expect(missions[0]).toHaveProperty('activityIcon');
	});

	it('findVisibleActivities は visible activity のみ返す', async () => {
		const activities = await dailyMissionRepo.findVisibleActivities('demo');
		expect(activities.every((a) => a.isVisible === 1)).toBe(true);
	});

	it('markMissionCompleted / insertDailyMission は no-op で fixture mutate なし', async () => {
		const before = DEMO_DAILY_MISSIONS.length;
		await dailyMissionRepo.markMissionCompleted(1, 'demo');
		await dailyMissionRepo.insertDailyMission(902, '2026-04-01', 1, 'demo');
		expect(DEMO_DAILY_MISSIONS.length).toBe(before);
	});

	it('findAllMissionStatuses は child + date でフィルタ済み', async () => {
		const sample = DEMO_DAILY_MISSIONS[0];
		expect(sample).toBeDefined();
		if (!sample) return;
		const statuses = await dailyMissionRepo.findAllMissionStatuses(
			sample.childId,
			sample.missionDate,
			'demo',
		);
		expect(statuses.length).toBeGreaterThan(0);
	});
});
