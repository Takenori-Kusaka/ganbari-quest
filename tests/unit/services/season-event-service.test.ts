import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindActiveEvents = vi.fn();
const mockFindAllEvents = vi.fn();
const mockFindChildProgress = vi.fn();
const mockFindEventByCode = vi.fn();
const mockFindEventById = vi.fn();
const mockInsertEvent = vi.fn();
const mockUpdateEvent = vi.fn();
const mockUpsertChildProgress = vi.fn();
const mockClaimReward = vi.fn();

vi.mock('$lib/server/db/season-event-repo', () => ({
	findActiveEvents: (...args: unknown[]) => mockFindActiveEvents(...args),
	findAllEvents: (...args: unknown[]) => mockFindAllEvents(...args),
	findChildProgress: (...args: unknown[]) => mockFindChildProgress(...args),
	findEventByCode: (...args: unknown[]) => mockFindEventByCode(...args),
	findEventById: (...args: unknown[]) => mockFindEventById(...args),
	insertEvent: (...args: unknown[]) => mockInsertEvent(...args),
	updateEvent: (...args: unknown[]) => mockUpdateEvent(...args),
	upsertChildProgress: (...args: unknown[]) => mockUpsertChildProgress(...args),
	claimReward: (...args: unknown[]) => mockClaimReward(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	checkEventMissionProgress,
	claimEventReward,
	createEvent,
	getActiveEventsForChild,
	getAllEvents,
	joinEvent,
} from '$lib/server/services/season-event-service';

const TENANT = 'test-tenant';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getAllEvents', () => {
	it('全イベントを返す', async () => {
		const events = [{ id: 1, name: 'テスト' }];
		mockFindAllEvents.mockResolvedValue(events);
		const result = await getAllEvents(TENANT);
		expect(result).toEqual(events);
	});
});

describe('getActiveEventsForChild', () => {
	it('開催中イベントと参加状況を返す', async () => {
		mockFindActiveEvents.mockResolvedValue([
			{ id: 1, name: 'スタートダッシュ', startDate: '2026-04-01', endDate: '2026-04-30' },
		]);
		mockFindChildProgress.mockResolvedValue({ status: 'active', progressJson: null });

		const result = await getActiveEventsForChild(1, TENANT);
		expect(result).toHaveLength(1);
		expect(result[0]?.progress).toEqual({ status: 'active', progressJson: null });
	});

	it('未参加のイベントは progress が null', async () => {
		mockFindActiveEvents.mockResolvedValue([
			{ id: 1, name: 'テスト', startDate: '2026-04-01', endDate: '2026-04-30' },
		]);
		mockFindChildProgress.mockResolvedValue(undefined);

		const result = await getActiveEventsForChild(1, TENANT);
		expect(result[0]?.progress).toBeNull();
	});
});

describe('joinEvent', () => {
	it('未参加なら参加レコードを作成', async () => {
		mockFindChildProgress.mockResolvedValue(undefined);
		mockUpsertChildProgress.mockResolvedValue(undefined);
		await joinEvent(1, 1, TENANT);
		expect(mockUpsertChildProgress).toHaveBeenCalledWith(1, 1, 'active', null, TENANT);
	});

	it('既に参加済みなら何もしない', async () => {
		mockFindChildProgress.mockResolvedValue({ status: 'active' });
		await joinEvent(1, 1, TENANT);
		expect(mockUpsertChildProgress).not.toHaveBeenCalled();
	});
});

describe('claimEventReward', () => {
	it('報酬を受け取れる', async () => {
		mockFindEventById.mockResolvedValue({ id: 1, rewardConfig: '{"points":100}' });
		mockFindChildProgress.mockResolvedValue({ status: 'active' });
		mockClaimReward.mockResolvedValue(undefined);

		const result = await claimEventReward(1, 1, TENANT);
		expect(result.rewardConfig).toBe('{"points":100}');
		expect(mockClaimReward).toHaveBeenCalled();
	});

	it('既に受取済みならエラー', async () => {
		mockFindEventById.mockResolvedValue({ id: 1 });
		mockFindChildProgress.mockResolvedValue({ status: 'reward_claimed' });

		await expect(claimEventReward(1, 1, TENANT)).rejects.toThrow('Already claimed');
	});

	it('未参加ならエラー', async () => {
		mockFindEventById.mockResolvedValue({ id: 1 });
		mockFindChildProgress.mockResolvedValue(undefined);

		await expect(claimEventReward(1, 1, TENANT)).rejects.toThrow('Not joined');
	});
});

describe('checkEventMissionProgress', () => {
	it('ミッション付きイベントの進捗を更新する', async () => {
		mockFindActiveEvents.mockResolvedValue([
			{
				id: 1,
				name: 'テスト',
				missionConfig: '{"type":"total_records","target":5}',
			},
		]);
		mockFindChildProgress.mockResolvedValue({
			status: 'active',
			progressJson: '{"count":2,"target":5}',
		});
		mockUpsertChildProgress.mockResolvedValue(undefined);

		const results = await checkEventMissionProgress(1, TENANT);
		expect(results).toHaveLength(1);
		expect(results[0]?.missionComplete).toBe(false);
		expect(mockUpsertChildProgress).toHaveBeenCalledWith(
			1,
			1,
			'active',
			'{"count":3,"target":5}',
			TENANT,
		);
	});

	it('ターゲット達成でcompleted状態にする', async () => {
		mockFindActiveEvents.mockResolvedValue([
			{
				id: 1,
				name: 'テスト',
				missionConfig: '{"type":"total_records","target":3}',
			},
		]);
		mockFindChildProgress.mockResolvedValue({
			status: 'active',
			progressJson: '{"count":2,"target":3}',
		});
		mockUpsertChildProgress.mockResolvedValue(undefined);

		const results = await checkEventMissionProgress(1, TENANT);
		expect(results[0]?.missionComplete).toBe(true);
		expect(mockUpsertChildProgress).toHaveBeenCalledWith(
			1,
			1,
			'completed',
			'{"count":3,"target":3}',
			TENANT,
		);
	});

	it('未参加なら自動参加して進捗を開始', async () => {
		mockFindActiveEvents.mockResolvedValue([
			{
				id: 1,
				name: 'テスト',
				missionConfig: '{"type":"total_records","target":10}',
			},
		]);
		mockFindChildProgress
			.mockResolvedValueOnce(undefined) // 最初のチェック: 未参加
			.mockResolvedValueOnce({ status: 'active', progressJson: null }); // 参加後のチェック
		mockUpsertChildProgress.mockResolvedValue(undefined);

		const results = await checkEventMissionProgress(1, TENANT);
		expect(results).toHaveLength(1);
		// 自動参加 + 進捗更新 = 2回呼ばれる
		expect(mockUpsertChildProgress).toHaveBeenCalledTimes(2);
	});

	it('missionConfigがないイベントはスキップ', async () => {
		mockFindActiveEvents.mockResolvedValue([{ id: 1, name: 'テスト', missionConfig: null }]);

		const results = await checkEventMissionProgress(1, TENANT);
		expect(results).toHaveLength(0);
	});
});

describe('createEvent', () => {
	it('新規イベントを作成', async () => {
		mockFindEventByCode.mockResolvedValue(undefined);
		mockInsertEvent.mockResolvedValue({ id: 1, code: 'spring-2026' });

		const result = await createEvent(
			{ code: 'spring-2026', name: 'しんがっき', startDate: '2026-04-01', endDate: '2026-04-30' },
			TENANT,
		);
		expect(result.code).toBe('spring-2026');
	});

	it('コード重複でエラー', async () => {
		mockFindEventByCode.mockResolvedValue({ id: 1 });

		await expect(
			createEvent(
				{
					code: 'spring-2026',
					name: 'テスト',
					startDate: '2026-04-01',
					endDate: '2026-04-30',
				},
				TENANT,
			),
		).rejects.toThrow('already exists');
	});
});
