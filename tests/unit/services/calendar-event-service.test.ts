import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock tenant-event-repo
const mockFindByTenantAndYear = vi.fn();
const mockFindByEventCode = vi.fn();
const mockUpsertEvent = vi.fn();
const mockUpdateEvent = vi.fn();
const mockFindProgress = vi.fn();
const mockFindProgressByChild = vi.fn();
const mockUpsertProgress = vi.fn();

vi.mock('$lib/server/db/tenant-event-repo', () => ({
	findByTenantAndYear: (...args: unknown[]) => mockFindByTenantAndYear(...args),
	findByEventCode: (...args: unknown[]) => mockFindByEventCode(...args),
	upsertEvent: (...args: unknown[]) => mockUpsertEvent(...args),
	updateEvent: (...args: unknown[]) => mockUpdateEvent(...args),
	findProgress: (...args: unknown[]) => mockFindProgress(...args),
	findProgressByChild: (...args: unknown[]) => mockFindProgressByChild(...args),
	upsertProgress: (...args: unknown[]) => mockUpsertProgress(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	getActiveCalendarEvents,
	getAllCalendarEventsForYear,
	getChildEventProgress,
	incrementEventProgress,
	setEventRewardMemo,
	toggleEvent,
} from '$lib/server/services/calendar-event-service';

const TENANT = 'test-tenant';
const CHILD_ID = 1;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getActiveCalendarEvents', () => {
	it('returns events active on the given date with tenant status', async () => {
		mockFindByTenantAndYear.mockResolvedValue([]);

		// April 15 should have 'spring-start'
		const result = await getActiveCalendarEvents(TENANT, new Date(2026, 3, 15));
		const ids = result.map((e) => e.definition.id);
		expect(ids).toContain('spring-start');
	});

	it('marks events as disabled when tenant has disabled them', async () => {
		mockFindByTenantAndYear.mockResolvedValue([
			{
				id: 1,
				tenantId: TENANT,
				eventCode: 'spring-start',
				year: 2026,
				enabled: 0,
				targetOverride: null,
				rewardMemo: null,
				createdAt: '2026-01-01T00:00:00Z',
				updatedAt: '2026-01-01T00:00:00Z',
			},
		]);

		const result = await getActiveCalendarEvents(TENANT, new Date(2026, 3, 15));
		const springStart = result.find((e) => e.definition.id === 'spring-start');
		expect(springStart?.enabled).toBe(false);
	});

	it('defaults to enabled when no tenant record exists', async () => {
		mockFindByTenantAndYear.mockResolvedValue([]);

		const result = await getActiveCalendarEvents(TENANT, new Date(2026, 3, 15));
		const springStart = result.find((e) => e.definition.id === 'spring-start');
		expect(springStart?.enabled).toBe(true);
	});
});

describe('getAllCalendarEventsForYear', () => {
	it('returns all events from the calendar for a given year', async () => {
		mockFindByTenantAndYear.mockResolvedValue([]);

		const result = await getAllCalendarEventsForYear(TENANT, 2026);
		// Should include all events from SEASON_EVENTS
		expect(result.length).toBeGreaterThanOrEqual(9);

		const ids = result.map((e) => e.definition.id);
		expect(ids).toContain('spring-start');
		expect(ids).toContain('christmas');
		expect(ids).toContain('new-year');
	});
});

describe('toggleEvent', () => {
	it('upserts the tenant event with enabled flag', async () => {
		mockUpsertEvent.mockResolvedValue({});

		await toggleEvent(TENANT, 'spring-start', false, 2026);

		expect(mockUpsertEvent).toHaveBeenCalledWith(
			{
				eventCode: 'spring-start',
				year: 2026,
				enabled: 0,
			},
			TENANT,
		);
	});

	it('defaults to current year when no year specified', async () => {
		mockUpsertEvent.mockResolvedValue({});

		await toggleEvent(TENANT, 'christmas', true);

		expect(mockUpsertEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventCode: 'christmas',
				enabled: 1,
			}),
			TENANT,
		);
	});
});

describe('setEventRewardMemo', () => {
	it('updates existing event with reward memo', async () => {
		mockFindByEventCode.mockResolvedValue({
			id: 5,
			tenantId: TENANT,
			eventCode: 'christmas',
			year: 2026,
			enabled: 1,
		});
		mockUpdateEvent.mockResolvedValue(undefined);

		await setEventRewardMemo(TENANT, 'christmas', 'ケーキを食べよう！', 2026);

		expect(mockUpdateEvent).toHaveBeenCalledWith(5, { rewardMemo: 'ケーキを食べよう！' }, TENANT);
	});

	it('creates new event record if none exists', async () => {
		mockFindByEventCode.mockResolvedValue(undefined);
		mockUpsertEvent.mockResolvedValue({});

		await setEventRewardMemo(TENANT, 'halloween', 'お菓子！', 2026);

		expect(mockUpsertEvent).toHaveBeenCalledWith(
			{
				eventCode: 'halloween',
				year: 2026,
				enabled: 1,
				rewardMemo: 'お菓子！',
			},
			TENANT,
		);
	});
});

describe('getChildEventProgress', () => {
	it('returns progress for active enabled events', async () => {
		mockFindByTenantAndYear.mockResolvedValue([]);
		mockFindProgressByChild.mockResolvedValue([
			{
				id: 1,
				tenantId: TENANT,
				eventCode: 'spring-start',
				childId: CHILD_ID,
				year: 2026,
				currentCount: 5,
				completedAt: null,
				createdAt: '2026-04-01T00:00:00Z',
				updatedAt: '2026-04-05T00:00:00Z',
			},
		]);

		// April 15 should include spring-start
		const result = await getChildEventProgress(CHILD_ID, TENANT, new Date(2026, 3, 15));
		const springEvent = result.find((e) => e.eventCode === 'spring-start');
		expect(springEvent).toBeDefined();
		expect(springEvent?.currentCount).toBe(5);
		expect(springEvent?.completed).toBe(false);
	});

	it('excludes disabled events', async () => {
		mockFindByTenantAndYear.mockResolvedValue([
			{
				id: 1,
				tenantId: TENANT,
				eventCode: 'spring-start',
				year: 2026,
				enabled: 0,
				targetOverride: null,
				rewardMemo: null,
				createdAt: '2026-01-01T00:00:00Z',
				updatedAt: '2026-01-01T00:00:00Z',
			},
		]);
		mockFindProgressByChild.mockResolvedValue([]);

		const result = await getChildEventProgress(CHILD_ID, TENANT, new Date(2026, 3, 15));
		const springEvent = result.find((e) => e.eventCode === 'spring-start');
		expect(springEvent).toBeUndefined();
	});
});

describe('incrementEventProgress', () => {
	it('increments progress when category matches a mission', async () => {
		mockFindByTenantAndYear.mockResolvedValue([]);
		mockFindProgress.mockResolvedValue(undefined);
		mockUpsertProgress.mockResolvedValue(undefined);

		// spring-start has missions for categoryId 2 (benkyou) and 3 (seikatsu)
		const result = await incrementEventProgress(
			CHILD_ID,
			2, // benkyou
			TENANT,
			new Date(2026, 3, 15),
		);

		expect(result.length).toBeGreaterThan(0);
		const springResult = result.find((r) => r.eventCode === 'spring-start');
		expect(springResult).toBeDefined();
		expect(mockUpsertProgress).toHaveBeenCalled();
	});

	it('does not increment for non-matching categories', async () => {
		mockFindByTenantAndYear.mockResolvedValue([]);
		mockFindProgress.mockResolvedValue(undefined);

		// In April, spring-start only has category 2 and 3 missions
		// Category 1 (undou) should not match spring-start
		const result = await incrementEventProgress(
			CHILD_ID,
			1, // undou
			TENANT,
			new Date(2026, 3, 15),
		);

		const springResult = result.find((r) => r.eventCode === 'spring-start');
		expect(springResult).toBeUndefined();
	});

	it('marks completed when target reached', async () => {
		mockFindByTenantAndYear.mockResolvedValue([]);
		// spring-start total target: 10 (benkyou) + 8 (seikatsu) = 18
		mockFindProgress.mockResolvedValue({
			id: 1,
			tenantId: TENANT,
			eventCode: 'spring-start',
			childId: CHILD_ID,
			year: 2026,
			currentCount: 17,
			completedAt: null,
		});
		mockUpsertProgress.mockResolvedValue(undefined);

		const result = await incrementEventProgress(CHILD_ID, 2, TENANT, new Date(2026, 3, 15));
		const springResult = result.find((r) => r.eventCode === 'spring-start');
		expect(springResult?.completed).toBe(true);
	});

	it('skips disabled events', async () => {
		mockFindByTenantAndYear.mockResolvedValue([
			{
				id: 1,
				tenantId: TENANT,
				eventCode: 'spring-start',
				year: 2026,
				enabled: 0,
				targetOverride: null,
				rewardMemo: null,
				createdAt: '2026-01-01T00:00:00Z',
				updatedAt: '2026-01-01T00:00:00Z',
			},
		]);

		const result = await incrementEventProgress(CHILD_ID, 2, TENANT, new Date(2026, 3, 15));
		const springResult = result.find((r) => r.eventCode === 'spring-start');
		expect(springResult).toBeUndefined();
		expect(mockUpsertProgress).not.toHaveBeenCalled();
	});

	it('skips already completed events', async () => {
		mockFindByTenantAndYear.mockResolvedValue([]);
		mockFindProgress.mockResolvedValue({
			id: 1,
			tenantId: TENANT,
			eventCode: 'spring-start',
			childId: CHILD_ID,
			year: 2026,
			currentCount: 20,
			completedAt: '2026-04-10T00:00:00Z',
		});

		const result = await incrementEventProgress(CHILD_ID, 2, TENANT, new Date(2026, 3, 15));
		const springResult = result.find((r) => r.eventCode === 'spring-start');
		expect(springResult).toBeUndefined();
	});
});
