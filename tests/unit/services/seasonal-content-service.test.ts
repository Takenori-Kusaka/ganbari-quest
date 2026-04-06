import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────
const mockFindActiveEvents = vi.fn();
const mockFindChildProgress = vi.fn();
const mockUpsertChildProgress = vi.fn();

vi.mock('$lib/server/db/season-event-repo', () => ({
	findActiveEvents: (...args: unknown[]) => mockFindActiveEvents(...args),
	findChildProgress: (...args: unknown[]) => mockFindChildProgress(...args),
	upsertChildProgress: (...args: unknown[]) => mockUpsertChildProgress(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { ChildEventProgress, SeasonEvent } from '$lib/server/db/types';
import {
	claimMonthlyPremiumReward,
	claimSeasonPassMilestone,
	getMemoryTicketStatus,
	getMonthlyPremiumReward,
	getSeasonPassForChild,
	incrementSeasonPassProgress,
} from '$lib/server/services/seasonal-content-service';

// ── Helpers ──────────────────────────────────────────────────
const TENANT = 'test-tenant';
const CHILD_ID = 1;

function makeSeasonPassEvent(overrides?: Partial<SeasonEvent>): SeasonEvent {
	return {
		id: 100,
		code: 'sp-2026-04',
		name: '4月シーズンパス',
		description: null,
		eventType: 'season_pass',
		startDate: '2026-04-01',
		endDate: '2026-04-30',
		bannerIcon: '🏆',
		bannerColor: null,
		themeConfig: null,
		rewardConfig: null,
		missionConfig: JSON.stringify({
			type: 'season_pass',
			milestones: [
				{ target: 5, track: 'free', reward: { type: 'points', value: 50 } },
				{ target: 10, track: 'free', reward: { type: 'badge', name: 'bronze' } },
				{ target: 15, track: 'premium', reward: { type: 'title', name: '冒険者' } },
			],
		}),
		isActive: 1,
		createdAt: '2026-04-01T00:00:00Z',
		updatedAt: '2026-04-01T00:00:00Z',
		...overrides,
	};
}

function makeMonthlyRewardEvent(overrides?: Partial<SeasonEvent>): SeasonEvent {
	return {
		id: 200,
		code: 'monthly-2026-04',
		name: '4月有料プラン報酬',
		description: null,
		eventType: 'monthly_premium_reward',
		startDate: '2026-04-01',
		endDate: '2026-04-30',
		bannerIcon: '🎁',
		bannerColor: null,
		themeConfig: null,
		rewardConfig: JSON.stringify({
			type: 'monthly_premium_reward',
			rewardType: 'title',
			name: '桜の勇者',
			icon: '🌸',
			description: '4月限定称号',
		}),
		missionConfig: null,
		isActive: 1,
		createdAt: '2026-04-01T00:00:00Z',
		updatedAt: '2026-04-01T00:00:00Z',
		...overrides,
	};
}

function makeProgress(overrides?: Partial<ChildEventProgress>): ChildEventProgress {
	return {
		id: 1,
		childId: CHILD_ID,
		eventId: 100,
		status: 'active',
		progressJson: JSON.stringify({ count: 0, claimedMilestones: [] }),
		rewardClaimedAt: null,
		joinedAt: '2026-04-01T00:00:00Z',
		updatedAt: '2026-04-01T00:00:00Z',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// Date.now を 2026-04-15 に固定（テスト安定化）
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));
});

// ============================================================
// getSeasonPassForChild
// ============================================================
describe('getSeasonPassForChild', () => {
	it('開催中のシーズンパスイベントがない場合 null を返す', async () => {
		mockFindActiveEvents.mockResolvedValue([]);

		const result = await getSeasonPassForChild(CHILD_ID, TENANT, false);
		expect(result).toBeNull();
	});

	it('missionConfig が不正な場合 null を返す', async () => {
		mockFindActiveEvents.mockResolvedValue([
			makeSeasonPassEvent({ missionConfig: '{ invalid json' }),
		]);

		const result = await getSeasonPassForChild(CHILD_ID, TENANT, false);
		expect(result).toBeNull();
	});

	it('開催中イベントがあれば進捗付きデータを返す', async () => {
		const event = makeSeasonPassEvent();
		const progress = makeProgress({
			progressJson: JSON.stringify({ count: 7, claimedMilestones: [] }),
		});
		mockFindActiveEvents.mockResolvedValue([event]);
		mockFindChildProgress.mockResolvedValue(progress);

		const result = await getSeasonPassForChild(CHILD_ID, TENANT, false);

		expect(result).not.toBeNull();
		expect(result?.progress.count).toBe(7);
		expect(result?.event.id).toBe(100);
		expect(result?.remainingDays).toBeGreaterThanOrEqual(0);
	});

	it('未参加の子供を自動参加させる', async () => {
		const event = makeSeasonPassEvent();
		// 1 回目 undefined → upsert → 2 回目で進捗を返す
		mockFindChildProgress.mockResolvedValueOnce(undefined).mockResolvedValueOnce(makeProgress());
		mockFindActiveEvents.mockResolvedValue([event]);
		mockUpsertChildProgress.mockResolvedValue(undefined);

		const result = await getSeasonPassForChild(CHILD_ID, TENANT, false);

		expect(mockUpsertChildProgress).toHaveBeenCalledWith(
			CHILD_ID,
			event.id,
			'active',
			null,
			TENANT,
		);
		expect(result).not.toBeNull();
	});

	it('フリーユーザーには free トラックのみ返す', async () => {
		mockFindActiveEvents.mockResolvedValue([makeSeasonPassEvent()]);
		mockFindChildProgress.mockResolvedValue(makeProgress());

		const result = await getSeasonPassForChild(CHILD_ID, TENANT, false);

		const tracks = result?.milestones.map((m) => m.track) ?? [];
		expect(tracks.every((t) => t === 'free')).toBe(true);
	});

	it('有料プランユーザーには free + premium 両トラックを返す', async () => {
		mockFindActiveEvents.mockResolvedValue([makeSeasonPassEvent()]);
		mockFindChildProgress.mockResolvedValue(makeProgress());

		const result = await getSeasonPassForChild(CHILD_ID, TENANT, true);

		const tracks = result?.milestones.map((m) => m.track) ?? [];
		expect(tracks).toContain('free');
		expect(tracks).toContain('premium');
	});

	it('achieved / claimed フラグが正しく設定される', async () => {
		mockFindActiveEvents.mockResolvedValue([makeSeasonPassEvent()]);
		mockFindChildProgress.mockResolvedValue(
			makeProgress({
				progressJson: JSON.stringify({
					count: 10,
					claimedMilestones: [{ target: 5, track: 'free' }],
				}),
			}),
		);

		const result = await getSeasonPassForChild(CHILD_ID, TENANT, true);

		const m5 = result?.milestones.find((m) => m.target === 5 && m.track === 'free');
		const m10 = result?.milestones.find((m) => m.target === 10 && m.track === 'free');
		const m15 = result?.milestones.find((m) => m.target === 15 && m.track === 'premium');

		expect(m5?.achieved).toBe(true);
		expect(m5?.claimed).toBe(true);
		expect(m10?.achieved).toBe(true);
		expect(m10?.claimed).toBe(false);
		expect(m15?.achieved).toBe(false);
		expect(m15?.claimed).toBe(false);
	});
});

// ============================================================
// claimSeasonPassMilestone
// ============================================================
describe('claimSeasonPassMilestone', () => {
	it('報酬を正常に受け取れる', async () => {
		const event = makeSeasonPassEvent();
		mockFindChildProgress.mockResolvedValue(
			makeProgress({
				progressJson: JSON.stringify({ count: 10, claimedMilestones: [] }),
			}),
		);
		mockFindActiveEvents.mockResolvedValue([event]);
		mockUpsertChildProgress.mockResolvedValue(undefined);

		const reward = await claimSeasonPassMilestone(CHILD_ID, 100, 5, 'free', TENANT);

		expect(reward).toEqual({ type: 'points', value: 50 });
		expect(mockUpsertChildProgress).toHaveBeenCalled();
	});

	it('既に受け取り済みの場合 null を返す', async () => {
		mockFindChildProgress.mockResolvedValue(
			makeProgress({
				progressJson: JSON.stringify({
					count: 10,
					claimedMilestones: [{ target: 5, track: 'free' }],
				}),
			}),
		);

		const reward = await claimSeasonPassMilestone(CHILD_ID, 100, 5, 'free', TENANT);
		expect(reward).toBeNull();
	});

	it('未達成のマイルストーンは受け取れない（null を返す）', async () => {
		mockFindChildProgress.mockResolvedValue(
			makeProgress({
				progressJson: JSON.stringify({ count: 3, claimedMilestones: [] }),
			}),
		);

		const reward = await claimSeasonPassMilestone(CHILD_ID, 100, 5, 'free', TENANT);
		expect(reward).toBeNull();
	});

	it('進捗レコードがない場合 null を返す', async () => {
		mockFindChildProgress.mockResolvedValue(undefined);

		const reward = await claimSeasonPassMilestone(CHILD_ID, 100, 5, 'free', TENANT);
		expect(reward).toBeNull();
	});
});

// ============================================================
// incrementSeasonPassProgress
// ============================================================
describe('incrementSeasonPassProgress', () => {
	it('カウントをインクリメントする', async () => {
		const event = makeSeasonPassEvent();
		mockFindActiveEvents.mockResolvedValue([event]);
		mockFindChildProgress.mockResolvedValue(
			makeProgress({
				progressJson: JSON.stringify({ count: 3, claimedMilestones: [] }),
			}),
		);
		mockUpsertChildProgress.mockResolvedValue(undefined);

		const result = await incrementSeasonPassProgress(CHILD_ID, TENANT);

		expect(result?.newCount).toBe(4);
		expect(mockUpsertChildProgress).toHaveBeenCalledWith(
			CHILD_ID,
			event.id,
			'active',
			expect.stringContaining('"count":4'),
			TENANT,
		);
	});

	it('新しく達成したマイルストーンを返す', async () => {
		const event = makeSeasonPassEvent();
		mockFindActiveEvents.mockResolvedValue([event]);
		mockFindChildProgress.mockResolvedValue(
			makeProgress({
				progressJson: JSON.stringify({ count: 4, claimedMilestones: [] }),
			}),
		);
		mockUpsertChildProgress.mockResolvedValue(undefined);

		const result = await incrementSeasonPassProgress(CHILD_ID, TENANT);

		// count: 4 → 5 で target:5 のマイルストーンが新規達成
		expect(result?.newMilestones).toHaveLength(1);
		expect(result?.newMilestones[0]?.target).toBe(5);
	});

	it('開催中イベントがない場合 null を返す', async () => {
		mockFindActiveEvents.mockResolvedValue([]);

		const result = await incrementSeasonPassProgress(CHILD_ID, TENANT);
		expect(result).toBeNull();
	});

	it('未参加の子供を自動参加させてからインクリメントする', async () => {
		const event = makeSeasonPassEvent();
		mockFindActiveEvents.mockResolvedValue([event]);
		mockFindChildProgress
			.mockResolvedValueOnce(undefined) // 初回: 未参加
			.mockResolvedValueOnce(makeProgress()); // upsert 後
		mockUpsertChildProgress.mockResolvedValue(undefined);

		const result = await incrementSeasonPassProgress(CHILD_ID, TENANT);

		// 自動参加の upsert + カウント更新の upsert = 2 回
		expect(mockUpsertChildProgress).toHaveBeenCalledTimes(2);
		expect(result?.newCount).toBe(1);
	});
});

// ============================================================
// getMonthlyPremiumReward
// ============================================================
describe('getMonthlyPremiumReward', () => {
	it('無料プランの場合 null を返す', async () => {
		const result = await getMonthlyPremiumReward(CHILD_ID, TENANT, false);
		expect(result).toBeNull();
		expect(mockFindActiveEvents).not.toHaveBeenCalled();
	});

	it('月替わり報酬イベントがない場合 null を返す', async () => {
		mockFindActiveEvents.mockResolvedValue([]);

		const result = await getMonthlyPremiumReward(CHILD_ID, TENANT, true);
		expect(result).toBeNull();
	});

	it('有料プランユーザーに報酬データを返す', async () => {
		const event = makeMonthlyRewardEvent();
		mockFindActiveEvents.mockResolvedValue([event]);
		mockFindChildProgress.mockResolvedValue(undefined);

		const result = await getMonthlyPremiumReward(CHILD_ID, TENANT, true);

		expect(result).not.toBeNull();
		expect(result?.config.name).toBe('桜の勇者');
		expect(result?.claimed).toBe(false);
	});

	it('既に受け取り済みの場合 claimed=true を返す', async () => {
		const event = makeMonthlyRewardEvent();
		mockFindActiveEvents.mockResolvedValue([event]);
		mockFindChildProgress.mockResolvedValue(
			makeProgress({ eventId: 200, status: 'reward_claimed' }),
		);

		const result = await getMonthlyPremiumReward(CHILD_ID, TENANT, true);

		expect(result?.claimed).toBe(true);
	});
});

// ============================================================
// claimMonthlyPremiumReward
// ============================================================
describe('claimMonthlyPremiumReward', () => {
	it('報酬を正常に受け取れる', async () => {
		const event = makeMonthlyRewardEvent();
		mockFindChildProgress.mockResolvedValue(undefined);
		mockFindActiveEvents.mockResolvedValue([event]);
		mockUpsertChildProgress.mockResolvedValue(undefined);

		const config = await claimMonthlyPremiumReward(CHILD_ID, 200, TENANT, true);

		expect(config).not.toBeNull();
		expect(config?.name).toBe('桜の勇者');
		expect(mockUpsertChildProgress).toHaveBeenCalledWith(
			CHILD_ID,
			200,
			'reward_claimed',
			expect.any(String),
			TENANT,
		);
	});

	it('既に受け取り済みの場合 null を返す', async () => {
		mockFindChildProgress.mockResolvedValue(
			makeProgress({ eventId: 200, status: 'reward_claimed' }),
		);

		const config = await claimMonthlyPremiumReward(CHILD_ID, 200, TENANT, true);
		expect(config).toBeNull();
	});

	it('無料プランの場合 null を返す', async () => {
		const config = await claimMonthlyPremiumReward(CHILD_ID, 200, TENANT, false);
		expect(config).toBeNull();
		expect(mockFindChildProgress).not.toHaveBeenCalled();
	});
});

// ============================================================
// getMemoryTicketStatus
// ============================================================
describe('getMemoryTicketStatus', () => {
	it('subscriptionStartDate が null の場合デフォルト値を返す', async () => {
		const status = await getMemoryTicketStatus(TENANT, null);

		expect(status.totalMonths).toBe(0);
		expect(status.ticketsEarned).toBe(0);
		expect(status.ticketsAvailable).toBe(0);
		expect(status.nextTicketAt).toBe(6);
	});

	it('開始日が現在と同月（0 か月経過）', async () => {
		const status = await getMemoryTicketStatus(TENANT, '2026-04-01');

		expect(status.totalMonths).toBe(0);
		expect(status.ticketsEarned).toBe(0);
		expect(status.nextTicketAt).toBe(6);
	});

	it('5 か月経過 — チケット未発行、あと 1 か月', async () => {
		const status = await getMemoryTicketStatus(TENANT, '2025-11-01');

		expect(status.totalMonths).toBe(5);
		expect(status.ticketsEarned).toBe(0);
		expect(status.nextTicketAt).toBe(1);
	});

	it('6 か月経過 — チケット 1 枚発行', async () => {
		const status = await getMemoryTicketStatus(TENANT, '2025-10-01');

		expect(status.totalMonths).toBe(6);
		expect(status.ticketsEarned).toBe(1);
		expect(status.ticketsAvailable).toBe(1);
		expect(status.nextTicketAt).toBe(6);
	});

	it('12 か月経過 — チケット 2 枚発行', async () => {
		const status = await getMemoryTicketStatus(TENANT, '2025-04-01');

		expect(status.totalMonths).toBe(12);
		expect(status.ticketsEarned).toBe(2);
		expect(status.ticketsAvailable).toBe(2);
		expect(status.nextTicketAt).toBe(6);
	});

	it('18 か月経過 — チケット 3 枚発行', async () => {
		const status = await getMemoryTicketStatus(TENANT, '2024-10-01');

		expect(status.totalMonths).toBe(18);
		expect(status.ticketsEarned).toBe(3);
		expect(status.ticketsAvailable).toBe(3);
		expect(status.nextTicketAt).toBe(6);
	});
});
