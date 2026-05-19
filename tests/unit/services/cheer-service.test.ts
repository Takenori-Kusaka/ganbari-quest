// tests/unit/services/cheer-service.test.ts
// 応援機能 (cheer-service) のユニットテスト — EPIC #2266 / #2267

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks ----------

const mockInsertPointEntry = vi.fn();
const mockFindChildById = vi.fn();
vi.mock('$lib/server/db/point-repo', () => ({
	insertPointEntry: (...args: unknown[]) => mockInsertPointEntry(...args),
	findChildById: (...args: unknown[]) => mockFindChildById(...args),
}));

const mockInsertMessage = vi.fn();
vi.mock('$lib/server/db/message-repo', () => ({
	insertMessage: (...args: unknown[]) => mockInsertMessage(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
	CHEER_CATEGORIES,
	CHEER_POINTS_MAX,
	CHEER_POINTS_MIN,
	CHEER_REASON_MAX_LENGTH,
	grantCheer,
} = await import('../../../src/lib/server/services/cheer-service');

// ---------- helpers ----------

const validInput = {
	childId: 1,
	reason: 'うんどうかいで 1いに なったね！',
	points: 100,
	category: 'うんどう',
	icon: '🎉',
};

const stubChild = {
	id: 1,
	nickname: 'たくみ',
	age: 8,
	birthDate: '2018-01-01',
	theme: 'blue',
	uiMode: 'elementary',
	uiModeManuallySet: 0,
	avatarUrl: null,
	displayConfig: null,
	userId: null,
	birthdayBonusMultiplier: 1.0,
	lastBirthdayBonusYear: null,
	isArchived: 0,
	archivedReason: null,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z',
};

// ---------- tests ----------

describe('CHEER constants', () => {
	it('CHEER_CATEGORIES は 6 カテゴリ', () => {
		expect(CHEER_CATEGORIES).toHaveLength(6);
		expect(CHEER_CATEGORIES).toContain('うんどう');
		expect(CHEER_CATEGORIES).toContain('とくべつ');
	});

	it('CHEER_REASON_MAX_LENGTH と CHEER_POINTS_MIN/MAX が定義されている', () => {
		expect(CHEER_REASON_MAX_LENGTH).toBe(100);
		expect(CHEER_POINTS_MIN).toBe(1);
		expect(CHEER_POINTS_MAX).toBe(10000);
	});
});

describe('grantCheer()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFindChildById.mockResolvedValue(stubChild);
		mockInsertPointEntry.mockResolvedValue({ id: 99 });
		mockInsertMessage.mockResolvedValue({
			id: 42,
			childId: 1,
			messageType: 'reward_notice',
			stampCode: null,
			body: 'うんどうかいで 1いに なったね！',
			icon: '🎉',
			sentAt: '2026-05-19T10:00:00Z',
			shownAt: null,
			bonusPoints: 100,
			rewardCategory: 'うんどう',
		});
	});

	it('正常系: point-ledger に + insertPointEntry / parent_messages に reward_notice 1 行 insert', async () => {
		const result = await grantCheer(validInput, 't-test');

		expect(result).toMatchObject({
			messageId: 42,
			pointEntryAmount: 100,
			description: expect.stringContaining('応援'),
		});

		expect(mockInsertPointEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: 1,
				amount: 100,
				type: 'cheer',
				description: expect.stringContaining('うんどうかいで 1いに なったね！'),
			}),
			't-test',
		);
		expect(mockInsertMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: 1,
				messageType: 'reward_notice',
				body: 'うんどうかいで 1いに なったね！',
				icon: '🎉',
				bonusPoints: 100,
				rewardCategory: 'うんどう',
			}),
			't-test',
		);
	});

	it('reason 空は INVALID_REASON エラー', async () => {
		const result = await grantCheer({ ...validInput, reason: '   ' }, 't-test');
		expect(result).toMatchObject({ error: 'INVALID_REASON' });
		expect(mockInsertPointEntry).not.toHaveBeenCalled();
		expect(mockInsertMessage).not.toHaveBeenCalled();
	});

	it('reason 101 文字は INVALID_REASON エラー', async () => {
		const result = await grantCheer({ ...validInput, reason: 'あ'.repeat(101) }, 't-test');
		expect(result).toMatchObject({ error: 'INVALID_REASON' });
	});

	it('points 0 は INVALID_POINTS エラー', async () => {
		const result = await grantCheer({ ...validInput, points: 0 }, 't-test');
		expect(result).toMatchObject({ error: 'INVALID_POINTS' });
	});

	it('points 10001 は INVALID_POINTS エラー', async () => {
		const result = await grantCheer({ ...validInput, points: 10001 }, 't-test');
		expect(result).toMatchObject({ error: 'INVALID_POINTS' });
	});

	it('category 不正は INVALID_CATEGORY エラー', async () => {
		const result = await grantCheer({ ...validInput, category: 'invalid' }, 't-test');
		expect(result).toMatchObject({ error: 'INVALID_CATEGORY' });
	});

	it('child 未登録は NOT_FOUND エラー', async () => {
		mockFindChildById.mockResolvedValue(null);
		const result = await grantCheer(validInput, 't-test');
		expect(result).toMatchObject({ error: 'NOT_FOUND', target: 'child' });
		expect(mockInsertPointEntry).not.toHaveBeenCalled();
	});

	it('付随スタンプ + body は noticeBody に合成される', async () => {
		await grantCheer(
			{
				...validInput,
				stampCode: 'sugoi',
				body: 'がんばったね',
			},
			'tenant-1',
		);
		expect(mockInsertMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				stampCode: 'sugoi',
				body: expect.stringContaining('がんばったね'),
			}),
			'tenant-1',
		);
	});

	it('parent_messages reward_notice の bonus_points と reward_category は input の値', async () => {
		await grantCheer({ ...validInput, points: 200, category: 'べんきょう' }, 'tenant-2');
		expect(mockInsertMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				bonusPoints: 200,
				rewardCategory: 'べんきょう',
			}),
			'tenant-2',
		);
	});
});
