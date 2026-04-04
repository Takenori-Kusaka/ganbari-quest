// tests/unit/domain/season-event-calendar.test.ts
import { describe, expect, it } from 'vitest';
import {
	SEASON_EVENTS,
	getActiveSeasonEvents,
	getEventDateRange,
} from '../../../src/lib/domain/season-event-calendar';

describe('season-event-calendar', () => {
	describe('SEASON_EVENTS', () => {
		it('should have unique IDs', () => {
			const ids = SEASON_EVENTS.map((e) => e.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it('should have valid month/day ranges', () => {
			for (const event of SEASON_EVENTS) {
				expect(event.startMonth).toBeGreaterThanOrEqual(1);
				expect(event.startMonth).toBeLessThanOrEqual(12);
				expect(event.endMonth).toBeGreaterThanOrEqual(1);
				expect(event.endMonth).toBeLessThanOrEqual(12);
				expect(event.startDay).toBeGreaterThanOrEqual(1);
				expect(event.startDay).toBeLessThanOrEqual(31);
				expect(event.endDay).toBeGreaterThanOrEqual(1);
				expect(event.endDay).toBeLessThanOrEqual(31);
			}
		});

		it('should have at least one default mission per event', () => {
			for (const event of SEASON_EVENTS) {
				expect(event.defaultMissions.length).toBeGreaterThan(0);
			}
		});

		it('should have valid category IDs in missions', () => {
			const validCategoryIds = [1, 2, 3, 4, 5];
			for (const event of SEASON_EVENTS) {
				for (const mission of event.defaultMissions) {
					expect(validCategoryIds).toContain(mission.categoryId);
					expect(mission.targetCount).toBeGreaterThan(0);
				}
			}
		});
	});

	describe('getActiveSeasonEvents', () => {
		it('should return spring-start for April 15', () => {
			const date = new Date(2026, 3, 15); // April 15
			const active = getActiveSeasonEvents(date);
			const ids = active.map((e) => e.id);
			expect(ids).toContain('spring-start');
		});

		it('should return kodomo-no-hi for May 3', () => {
			const date = new Date(2026, 4, 3); // May 3
			const active = getActiveSeasonEvents(date);
			const ids = active.map((e) => e.id);
			expect(ids).toContain('kodomo-no-hi');
		});

		it('should return summer-vacation for August 1', () => {
			const date = new Date(2026, 7, 1); // Aug 1
			const active = getActiveSeasonEvents(date);
			const ids = active.map((e) => e.id);
			expect(ids).toContain('summer-vacation');
		});

		it('should return halloween for October 15', () => {
			const date = new Date(2026, 9, 15); // Oct 15
			const active = getActiveSeasonEvents(date);
			const ids = active.map((e) => e.id);
			expect(ids).toContain('halloween');
		});

		it('should return christmas for December 10', () => {
			const date = new Date(2026, 11, 10); // Dec 10
			const active = getActiveSeasonEvents(date);
			const ids = active.map((e) => e.id);
			expect(ids).toContain('christmas');
		});

		it('should return new-year for January 5', () => {
			const date = new Date(2026, 0, 5); // Jan 5
			const active = getActiveSeasonEvents(date);
			const ids = active.map((e) => e.id);
			expect(ids).toContain('new-year');
		});

		it('should return setsubun for February 2', () => {
			const date = new Date(2026, 1, 2); // Feb 2
			const active = getActiveSeasonEvents(date);
			const ids = active.map((e) => e.id);
			expect(ids).toContain('setsubun');
		});

		it('should return hinamatsuri for March 3', () => {
			const date = new Date(2026, 2, 3); // Mar 3
			const active = getActiveSeasonEvents(date);
			const ids = active.map((e) => e.id);
			expect(ids).toContain('hinamatsuri');
		});

		it('should return empty for a date with no events (June 15)', () => {
			const date = new Date(2026, 5, 15); // June 15
			const active = getActiveSeasonEvents(date);
			expect(active.length).toBe(0);
		});

		it('should not return events outside their date range', () => {
			const date = new Date(2026, 3, 15); // April 15
			const active = getActiveSeasonEvents(date);
			const ids = active.map((e) => e.id);
			expect(ids).not.toContain('christmas');
			expect(ids).not.toContain('summer-vacation');
			expect(ids).not.toContain('halloween');
		});
	});

	describe('getEventDateRange', () => {
		it('should return correct date range for a normal event', () => {
			const springStart = SEASON_EVENTS.find((e) => e.id === 'spring-start');
			expect(springStart).toBeDefined();
			if (!springStart) return;

			const { startDate, endDate } = getEventDateRange(springStart, 2026);
			expect(startDate).toBe('2026-04-01');
			expect(endDate).toBe('2026-04-30');
		});

		it('should return correct date range for a short event', () => {
			const setsubun = SEASON_EVENTS.find((e) => e.id === 'setsubun');
			expect(setsubun).toBeDefined();
			if (!setsubun) return;

			const { startDate, endDate } = getEventDateRange(setsubun, 2026);
			expect(startDate).toBe('2026-02-01');
			expect(endDate).toBe('2026-02-03');
		});
	});
});
