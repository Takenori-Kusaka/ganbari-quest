import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock: settings-repo ---
const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: (...args: unknown[]) => mockGetSetting(...args),
	setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	consumeMemoryTicket,
	getChurnPreventionData,
	getCurrentTier,
	getLoginBonusMultiplier,
	getLoyaltyInfo,
	getNextTier,
	getSubscriptionMonths,
	getTierStatus,
	incrementSubscriptionMonth,
} from '$lib/server/services/loyalty-service';

const TENANT = 'test-tenant';

beforeEach(() => {
	vi.resetAllMocks();
});

describe('getCurrentTier', () => {
	it('0ヶ月はデフォルトティア', () => {
		expect(getCurrentTier(0).name).toBe('はじめてのぼうけんしゃ');
	});

	it('1ヶ月で最初のティア', () => {
		expect(getCurrentTier(1).name).toBe('はじめてのぼうけんしゃ');
	});

	it('3ヶ月でティアアップ', () => {
		expect(getCurrentTier(3).name).toBe('きせつのたびびと');
	});

	it('6ヶ月でベテラン', () => {
		expect(getCurrentTier(6).name).toBe('ベテランぼうけんしゃ');
	});

	it('12ヶ月ででんせつ', () => {
		expect(getCurrentTier(12).name).toBe('でんせつのぼうけんしゃ');
	});

	it('24ヶ月でマスター', () => {
		expect(getCurrentTier(24).name).toBe('がんばりクエスト マスター');
	});

	it('100ヶ月でもマスター（最高ティア）', () => {
		expect(getCurrentTier(100).name).toBe('がんばりクエスト マスター');
	});
});

describe('getNextTier', () => {
	it('0ヶ月の次は1ヶ月', () => {
		const next = getNextTier(0);
		expect(next?.months).toBe(1);
		expect(next?.remaining).toBe(1);
	});

	it('2ヶ月の次は3ヶ月', () => {
		const next = getNextTier(2);
		expect(next?.months).toBe(3);
		expect(next?.remaining).toBe(1);
	});

	it('24ヶ月以上は次がない', () => {
		expect(getNextTier(24)).toBeNull();
		expect(getNextTier(50)).toBeNull();
	});
});

describe('getLoginBonusMultiplier', () => {
	it('0ヶ月は1.0倍', () => {
		expect(getLoginBonusMultiplier(0)).toBe(1.0);
	});

	it('3ヶ月は1.2倍', () => {
		expect(getLoginBonusMultiplier(3)).toBe(1.2);
	});

	it('6ヶ月は1.3倍', () => {
		expect(getLoginBonusMultiplier(6)).toBe(1.3);
	});

	it('12ヶ月は1.5倍', () => {
		expect(getLoginBonusMultiplier(12)).toBe(1.5);
	});
});

describe('getTierStatus', () => {
	it('6ヶ月で3ティア解放', () => {
		const { tiers, currentTier, nextTier } = getTierStatus(6);
		const unlocked = tiers.filter((t) => t.unlocked);
		expect(unlocked.length).toBe(3); // 1, 3, 6
		expect(currentTier.name).toBe('ベテランぼうけんしゃ');
		expect(nextTier?.months).toBe(12);
	});
});

describe('getSubscriptionMonths', () => {
	it('設定なしは0', async () => {
		mockGetSetting.mockResolvedValue(null);
		const result = await getSubscriptionMonths(TENANT);
		expect(result).toBe(0);
	});

	it('設定ありは数値変換', async () => {
		mockGetSetting.mockResolvedValue('8');
		const result = await getSubscriptionMonths(TENANT);
		expect(result).toBe(8);
	});
});

describe('incrementSubscriptionMonth', () => {
	it('月次インクリメント成功', async () => {
		mockGetSetting
			.mockResolvedValueOnce(null) // lastIncrementMonth
			.mockResolvedValueOnce('2'); // subscriptionMonths
		mockSetSetting.mockResolvedValue(undefined);

		const result = await incrementSubscriptionMonth(TENANT);
		expect(result.newMonths).toBe(3);
		expect(result.tierUp).toBe(true);
		expect(result.newTier?.name).toBe('きせつのたびびと');
	});

	it('同月の二重インクリメント防止', async () => {
		const currentMonth = new Date().toISOString().slice(0, 7);
		mockGetSetting
			.mockResolvedValueOnce(currentMonth) // lastIncrementMonth = 今月
			.mockResolvedValueOnce('5'); // subscriptionMonths

		const result = await incrementSubscriptionMonth(TENANT);
		expect(result.newMonths).toBe(5);
		expect(result.tierUp).toBe(false);
		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('ティア到達でチケット付与', async () => {
		mockGetSetting
			.mockResolvedValueOnce(null) // lastIncrementMonth
			.mockResolvedValueOnce('5') // subscriptionMonths (5→6)
			.mockResolvedValueOnce('0'); // memoryTickets
		mockSetSetting.mockResolvedValue(undefined);

		const result = await incrementSubscriptionMonth(TENANT);
		expect(result.newMonths).toBe(6);
		expect(result.tierUp).toBe(true);
		expect(result.ticketsAwarded).toBe(1);
	});
});

describe('consumeMemoryTicket', () => {
	it('チケットあり → 消費成功', async () => {
		mockGetSetting.mockResolvedValue('3');
		mockSetSetting.mockResolvedValue(undefined);
		const result = await consumeMemoryTicket(TENANT);
		expect(result.success).toBe(true);
		expect(result.remaining).toBe(2);
	});

	it('チケット0 → 失敗', async () => {
		mockGetSetting.mockResolvedValue('0');
		const result = await consumeMemoryTicket(TENANT);
		expect(result.success).toBe(false);
	});
});

describe('getLoyaltyInfo', () => {
	it('情報を正しく構築', async () => {
		mockGetSetting.mockResolvedValueOnce('6').mockResolvedValueOnce('1');
		const info = await getLoyaltyInfo(TENANT);
		expect(info.subscriptionMonths).toBe(6);
		expect(info.memoryTickets).toBe(1);
		expect(info.currentTier.name).toBe('ベテランぼうけんしゃ');
		expect(info.loginBonusMultiplier).toBe(1.3);
	});
});

describe('getChurnPreventionData', () => {
	it('失うものリストを構築', async () => {
		mockGetSetting.mockResolvedValueOnce('8').mockResolvedValueOnce('2');
		const data = await getChurnPreventionData(TENANT);
		expect(data.subscriptionMonths).toBe(8);
		expect(data.lostItems).toContain('月替わり限定アイテム 8個');
		expect(data.lostItems).toContain('思い出チケット 2枚');
		expect(data.lostItems.some((i) => i.includes('ログインボーナス'))).toBe(true);
	});
});
