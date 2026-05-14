/**
 * ProductionDashboardService.toViewModel() unit tests — ADR-0047 Phase 2
 *
 * UI Contract `ChildHomeViewModel` 構築の核心 logic を検証する:
 *   - `progressDisplay.type` のコンテキスト法則切替 (baby/preschool/free → today-missions、
 *     elementary 以上 + standard 以上 → category-level)
 *   - `currency` の pointSettings.mode 反映 (point → 'P'/POINTS、currency → '¥'/JPY)
 *   - `features.*` の plan / age 状態からの導出
 *   - `activities` の todayRecorded merge
 *   - `ageContext.isBabyParentMode` の baby 判定 (ADR-0011)
 */
import { describe, expect, it } from 'vitest';
import type { Child } from '$lib/server/db/types/index.js';
import { ProductionDashboardService } from '$lib/services/production/DashboardService';
import type { ChildDashboardHomeData, ToViewModelContext } from '$lib/services/types';

function makeChild(overrides: Partial<Child> = {}): Child {
	return {
		id: 1,
		nickname: 'たろう',
		age: 7,
		birthDate: '2018-01-01',
		theme: 'pink',
		uiMode: 'elementary',
		uiModeManuallySet: 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1,
		lastBirthdayBonusYear: null,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

function makeHomeData(overrides: Partial<ChildDashboardHomeData> = {}): ChildDashboardHomeData {
	return {
		child: makeChild(),
		todayRecorded: [],
		pointSettings: { mode: 'point', currency: 'JPY', rate: 1 },
		...overrides,
	};
}

function makeCtx(overrides: Partial<ToViewModelContext> = {}): ToViewModelContext {
	return {
		uiMode: 'elementary',
		planTier: 'standard',
		isTrialActive: false,
		isPremium: true,
		activities: [],
		mustStatus: null,
		dailyMissions: null,
		categoryXp: null,
		activeEventBadge: null,
		...overrides,
	};
}

describe('ProductionDashboardService.toViewModel()', () => {
	describe('currency contract (Q4)', () => {
		it('returns P/POINTS when pointSettings.mode is point', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx());
			expect(vm.currency).toEqual({ symbol: 'P', code: 'POINTS' });
		});

		it('returns ¥/JPY when pointSettings.mode is currency', () => {
			const svc = new ProductionDashboardService(() =>
				makeHomeData({ pointSettings: { mode: 'currency', currency: 'JPY', rate: 1 } }),
			);
			const vm = svc.toViewModel(makeCtx());
			expect(vm.currency).toEqual({ symbol: '¥', code: 'JPY' });
		});
	});

	describe('progressDisplay context law (deep research §5 案 B core)', () => {
		it('baby uiMode → today-missions', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(
				makeCtx({
					uiMode: 'baby',
					mustStatus: { logged: 1, total: 3, granted: false, points: 0 },
				}),
			);
			expect(vm.progressDisplay.type).toBe('today-missions');
			if (vm.progressDisplay.type === 'today-missions') {
				expect(vm.progressDisplay.mustStatus).toEqual({ completed: 1, total: 3 });
			}
		});

		it('preschool uiMode → today-missions', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ uiMode: 'preschool' }));
			expect(vm.progressDisplay.type).toBe('today-missions');
		});

		it('free plan → today-missions regardless of age', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ uiMode: 'elementary', planTier: 'free' }));
			expect(vm.progressDisplay.type).toBe('today-missions');
		});

		it('elementary + standard plan → category-level', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(
				makeCtx({
					uiMode: 'elementary',
					planTier: 'standard',
					categoryXp: {
						1: { value: 10, level: 2, levelTitle: '初心', progressPct: 50, maxValue: 100 },
					},
				}),
			);
			expect(vm.progressDisplay.type).toBe('category-level');
			if (vm.progressDisplay.type === 'category-level') {
				expect(vm.progressDisplay.categories).toHaveLength(1);
				expect(vm.progressDisplay.categories[0]).toEqual({
					id: 1,
					name: '初心',
					level: 2,
					xpPercent: 50,
				});
			}
		});

		it('junior + family plan → category-level', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ uiMode: 'junior', planTier: 'family' }));
			expect(vm.progressDisplay.type).toBe('category-level');
		});

		it('senior + standard plan → category-level', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ uiMode: 'senior', planTier: 'standard' }));
			expect(vm.progressDisplay.type).toBe('category-level');
		});
	});

	describe('features contract (9 flags)', () => {
		it('baby suppresses gamification features (ADR-0011)', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ uiMode: 'baby' }));
			expect(vm.features.showXpAnimation).toBe(false);
			expect(vm.features.showMissionBadge).toBe(false);
			expect(vm.features.showPinButton).toBe(false);
			expect(vm.features.showSiblingRanking).toBe(false);
			expect(vm.features.showBirthdayBonus).toBe(false);
			expect(vm.features.showMonthlyReward).toBe(false);
			expect(vm.features.showStampCard).toBe(false);
			// shop タブは year-round 表示 (Q5 = B)
			expect(vm.features.showShopTab).toBe(true);
		});

		it('elementary + family enables all features', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ uiMode: 'elementary', planTier: 'family' }));
			expect(vm.features.showXpAnimation).toBe(true);
			expect(vm.features.showMissionBadge).toBe(true);
			expect(vm.features.showPinButton).toBe(true);
			expect(vm.features.showSiblingRanking).toBe(true);
			expect(vm.features.showStampCard).toBe(true);
		});

		it('standard plan does not enable sibling ranking (family only)', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ planTier: 'standard' }));
			expect(vm.features.showSiblingRanking).toBe(false);
		});

		it('non-premium suppresses monthly reward', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ isPremium: false }));
			expect(vm.features.showMonthlyReward).toBe(false);
		});

		it('showEventBadge requires non-null activeEventBadge', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vmNoEvent = svc.toViewModel(makeCtx({ activeEventBadge: null }));
			expect(vmNoEvent.features.showEventBadge).toBe(false);
			const vmEvent = svc.toViewModel(makeCtx({ activeEventBadge: '🎉' }));
			expect(vmEvent.features.showEventBadge).toBe(true);
		});
	});

	describe('activities merge with todayRecorded', () => {
		it('attaches todayRecorded count to each activity', () => {
			const svc = new ProductionDashboardService(() =>
				makeHomeData({
					todayRecorded: [
						{ activityId: 1, count: 2 },
						{ activityId: 3, count: 1 },
					],
				}),
			);
			const vm = svc.toViewModel(
				makeCtx({
					activities: [
						{ id: 1, name: 'うんどう', icon: '🏃', categoryId: 1, dailyLimit: 3, basePoints: 5 },
						{ id: 2, name: 'べんきょう', icon: '📚', categoryId: 2, dailyLimit: 2, basePoints: 5 },
						{ id: 3, name: 'おてつだい', icon: '🧹', categoryId: 3, dailyLimit: 1, basePoints: 5 },
					],
				}),
			);
			expect(vm.activities).toHaveLength(3);
			expect(vm.activities[0]).toMatchObject({ id: 1, todayRecorded: 2, pointReward: 5 });
			expect(vm.activities[1]).toMatchObject({ id: 2, todayRecorded: 0 });
			expect(vm.activities[2]).toMatchObject({ id: 3, todayRecorded: 1 });
		});

		it('treats activities with isMission true as must (mission badge)', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(
				makeCtx({
					activities: [
						{ id: 1, name: 'a', icon: '', categoryId: 1, dailyLimit: 1, isMission: true },
						{ id: 2, name: 'b', icon: '', categoryId: 1, dailyLimit: 1, isMission: false },
					],
				}),
			);
			expect(vm.activities[0]?.isMust).toBe(true);
			expect(vm.activities[1]?.isMust).toBe(false);
		});

		it('coerces isPinned number 1 to true', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(
				makeCtx({
					activities: [{ id: 1, name: 'a', icon: '', categoryId: 1, dailyLimit: 1, isPinned: 1 }],
				}),
			);
			expect(vm.activities[0]?.isPinned).toBe(true);
		});
	});

	describe('ageContext (ADR-0011 baby parent mode)', () => {
		it('marks isBabyParentMode true when uiMode is baby', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ uiMode: 'baby' }));
			expect(vm.ageContext.isBabyParentMode).toBe(true);
			expect(vm.ageContext.ageTier).toBe('baby');
		});

		it('marks isBabyParentMode false for preschool and above', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			for (const uiMode of ['preschool', 'elementary', 'junior', 'senior'] as const) {
				const vm = svc.toViewModel(makeCtx({ uiMode }));
				expect(vm.ageContext.isBabyParentMode).toBe(false);
				expect(vm.ageContext.ageTier).toBe(uiMode);
			}
		});

		it('propagates planTier and isTrialActive from context', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			const vm = svc.toViewModel(makeCtx({ planTier: 'family', isTrialActive: true }));
			expect(vm.ageContext.planTier).toBe('family');
			expect(vm.ageContext.isTrialActive).toBe(true);
		});
	});

	describe('child fallback when null', () => {
		it('returns sentinel child when home.child is null (SSR initial)', () => {
			const svc = new ProductionDashboardService(() => makeHomeData({ child: null }));
			const vm = svc.toViewModel(makeCtx({ uiMode: 'elementary' }));
			expect(vm.child).toEqual({
				id: 0,
				nickname: '',
				pointBalance: 0,
				level: 1,
				xpToNextLevel: 0,
				xpInLevel: 0,
				streakDays: 0,
				uiMode: 'elementary',
			});
		});
	});

	describe('uiMode passthrough', () => {
		it('reflects ctx.uiMode in viewModel.uiMode', () => {
			const svc = new ProductionDashboardService(() => makeHomeData());
			for (const uiMode of ['baby', 'preschool', 'elementary', 'junior', 'senior'] as const) {
				const vm = svc.toViewModel(makeCtx({ uiMode }));
				expect(vm.uiMode).toBe(uiMode);
			}
		});
	});
});
