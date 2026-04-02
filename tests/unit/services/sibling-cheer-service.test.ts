import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInsertCheer = vi.fn();
const mockFindUnshownCheers = vi.fn();
const mockMarkShown = vi.fn();
const mockCountTodayCheersFrom = vi.fn();
const mockFindAllChildren = vi.fn();

vi.mock('$lib/server/db/sibling-cheer-repo', () => ({
	insertCheer: (...args: unknown[]) => mockInsertCheer(...args),
	findUnshownCheers: (...args: unknown[]) => mockFindUnshownCheers(...args),
	markShown: (...args: unknown[]) => mockMarkShown(...args),
	countTodayCheersFrom: (...args: unknown[]) => mockCountTodayCheersFrom(...args),
}));

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
}));

import {
	getStampByCode,
	getUnshownCheers,
	markCheersShown,
	sendCheer,
} from '$lib/server/services/sibling-cheer-service';

const TENANT = 'test-tenant';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getStampByCode', () => {
	it('有効なコードでスタンプを返す', () => {
		const stamp = getStampByCode('ganbare');
		expect(stamp?.label).toBe('がんばって！');
		expect(stamp?.emoji).toBe('💪');
	});

	it('無効なコードで null を返す', () => {
		expect(getStampByCode('invalid')).toBeNull();
	});
});

describe('sendCheer', () => {
	it('正常にスタンプを送信', async () => {
		mockCountTodayCheersFrom.mockResolvedValue(0);
		mockInsertCheer.mockResolvedValue({
			id: 1,
			fromChildId: 1,
			toChildId: 2,
			stampCode: 'ganbare',
			sentAt: '2026-04-02',
			shownAt: null,
		});

		const result = await sendCheer(1, 2, 'ganbare', TENANT);
		expect('success' in result && result.success).toBe(true);
		expect(mockInsertCheer).toHaveBeenCalledWith(
			{ fromChildId: 1, toChildId: 2, stampCode: 'ganbare' },
			TENANT,
		);
	});

	it('自分への送信は拒否', async () => {
		const result = await sendCheer(1, 1, 'ganbare', TENANT);
		expect('error' in result).toBe(true);
		if ('error' in result) {
			expect(result.error).toContain('じぶん');
		}
	});

	it('無効なスタンプコードは拒否', async () => {
		const result = await sendCheer(1, 2, 'invalid', TENANT);
		expect('error' in result).toBe(true);
	});

	it('1日5回上限を超えると拒否', async () => {
		mockCountTodayCheersFrom.mockResolvedValue(5);

		const result = await sendCheer(1, 2, 'ganbare', TENANT);
		expect('error' in result).toBe(true);
		if ('error' in result) {
			expect(result.error).toContain('5');
		}
	});

	it('4回目までは送信可能', async () => {
		mockCountTodayCheersFrom.mockResolvedValue(4);
		mockInsertCheer.mockResolvedValue({
			id: 1,
			fromChildId: 1,
			toChildId: 2,
			stampCode: 'nice',
			sentAt: '2026-04-02',
			shownAt: null,
		});

		const result = await sendCheer(1, 2, 'nice', TENANT);
		expect('success' in result && result.success).toBe(true);
	});
});

describe('getUnshownCheers', () => {
	it('未表示のおうえんを名前付きで返す', async () => {
		mockFindUnshownCheers.mockResolvedValue([
			{
				id: 1,
				fromChildId: 1,
				toChildId: 2,
				stampCode: 'ganbare',
				sentAt: '2026-04-02',
				shownAt: null,
			},
		]);
		mockFindAllChildren.mockResolvedValue([
			{ id: 1, nickname: 'ゆい' },
			{ id: 2, nickname: 'けん' },
		]);

		const result = await getUnshownCheers(2, TENANT);
		expect(result).toHaveLength(1);
		expect(result[0]?.fromName).toBe('ゆい');
		expect(result[0]?.stampLabel).toBe('がんばって！');
		expect(result[0]?.stampEmoji).toBe('💪');
	});

	it('おうえんが0件なら空配列', async () => {
		mockFindUnshownCheers.mockResolvedValue([]);
		const result = await getUnshownCheers(2, TENANT);
		expect(result).toHaveLength(0);
		expect(mockFindAllChildren).not.toHaveBeenCalled();
	});
});

describe('markCheersShown', () => {
	it('markShown を委譲', async () => {
		mockMarkShown.mockResolvedValue(undefined);
		await markCheersShown([1, 2], TENANT);
		expect(mockMarkShown).toHaveBeenCalledWith([1, 2], TENANT);
	});
});
