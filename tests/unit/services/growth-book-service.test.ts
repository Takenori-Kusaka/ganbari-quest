// tests/unit/services/growth-book-service.test.ts
// 成長記録ブックサービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/services/child-service', () => ({
	getChildById: vi.fn(),
}));
vi.mock('$lib/server/services/report-service', () => ({
	computeDetailedMonthlyReport: vi.fn(),
}));
vi.mock('$lib/server/services/status-service', () => ({
	getChildStatus: vi.fn(),
}));
vi.mock('$lib/server/services/certificate-service', () => ({
	getCertificatesForChild: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getCertificatesForChild } from '../../../src/lib/server/services/certificate-service';
import { getChildById } from '../../../src/lib/server/services/child-service';
import { buildGrowthBook } from '../../../src/lib/server/services/growth-book-service';
import type {
	GrowthBookData,
	MonthPage,
} from '../../../src/lib/server/services/growth-book-service';
import { computeDetailedMonthlyReport } from '../../../src/lib/server/services/report-service';
import { getChildStatus } from '../../../src/lib/server/services/status-service';

const TENANT = 'test-tenant';
const CHILD_ID = 1;
const FISCAL_YEAR = '2025';

const mockChild = {
	id: 1,
	nickname: 'テストちゃん',
	age: 5,
	theme: 'pink',
	uiMode: 'kinder',
	tenantId: TENANT,
	avatarUrl: null,
	birthDate: null,
	activeTitleId: null,
	displayConfig: null,
	userId: null,
	birthdayBonusMultiplier: 1,
	lastBirthdayBonusYear: null,
	createdAt: '2025-01-01',
	updatedAt: '2025-01-01',
};

const mockStatus = {
	childId: CHILD_ID,
	level: 10,
	levelTitle: 'すごい冒険者',
	totalXp: 5000,
	expToNextLevel: 1000,
	nextLevelXp: 6000,
	maxValue: 100,
	statuses: {},
	currentCharacterType: 'バランス型',
	characterType: 'バランス型',
	highestCategoryLevel: 5,
} as const;

function makeReport(
	yearMonth: string,
	overrides: Partial<{
		totalActivities: number;
		categoryBreakdown: Record<string, number>;
		totalPoints: number;
		currentLevel: number;
		maxStreakDays: number;
		totalNewAchievements: number;
		daysWithActivity: number;
		totalDays: number;
	}> = {},
) {
	return {
		childId: CHILD_ID,
		childName: mockChild.nickname,
		month: yearMonth,
		totalActivities: 0,
		categoryBreakdown: {},
		avgDailyActivities: 0,
		currentLevel: 1,
		totalPoints: 0,
		maxStreakDays: 0,
		totalNewAchievements: 0,
		daysWithActivity: 0,
		totalDays: 30,
		...overrides,
	};
}

const EXPECTED_MONTHS = [
	'2025-04',
	'2025-05',
	'2025-06',
	'2025-07',
	'2025-08',
	'2025-09',
	'2025-10',
	'2025-11',
	'2025-12',
	'2026-01',
	'2026-02',
	'2026-03',
];

function makeCert(id: number, type: string) {
	return {
		id,
		childId: CHILD_ID,
		tenantId: TENANT,
		certificateType: type,
		title: `証明書${id}`,
		description: null,
		metadata: null,
		issuedAt: '2025-06-01',
		icon: '🏆',
		category: 'streak' as const,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('buildGrowthBook', () => {
	it('子供が見つからない場合はnullを返す', async () => {
		vi.mocked(getChildById).mockResolvedValue(undefined);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);

		expect(result).toBeNull();
		expect(getChildById).toHaveBeenCalledWith(CHILD_ID, TENANT);
		expect(computeDetailedMonthlyReport).not.toHaveBeenCalled();
	});

	it('12ヶ月分のデータで成長記録ブックを生成する', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(
			async (_tenantId, _childId, _name, yearMonth) =>
				makeReport(yearMonth, { totalActivities: 5, totalPoints: 50 }),
		);
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);

		expect(result).not.toBeNull();
		const book = result as GrowthBookData;
		expect(book.childId).toBe(CHILD_ID);
		expect(book.childName).toBe('テストちゃん');
		expect(book.fiscalYear).toBe(FISCAL_YEAR);
		expect(book.months).toHaveLength(12);
		expect(book.currentLevel).toBe(10);
		expect(book.levelTitle).toBe('すごい冒険者');
	});

	it('年度2025なら2025-04から2026-03までの月範囲を処理する', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(
			async (_tenantId, _childId, _name, yearMonth) => makeReport(yearMonth),
		);
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		const monthStrings = book.months.map((m: MonthPage) => m.month);
		expect(monthStrings).toEqual(EXPECTED_MONTHS);

		// computeDetailedMonthlyReport が各月で呼ばれたことを確認
		for (const ym of EXPECTED_MONTHS) {
			expect(computeDetailedMonthlyReport).toHaveBeenCalledWith(
				TENANT,
				CHILD_ID,
				mockChild.nickname,
				ym,
			);
		}
		expect(computeDetailedMonthlyReport).toHaveBeenCalledTimes(12);
	});

	it('最も活動が多い月をbestMonthとして返す', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) => {
			if (yearMonth === '2025-08') {
				return makeReport(yearMonth, { totalActivities: 50 });
			}
			return makeReport(yearMonth, { totalActivities: 3 });
		});
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		expect(book.bestMonth).toBe('2025-08');
	});

	it('カテゴリ合計が最大のものをbestCategoryとして返す', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) =>
			makeReport(yearMonth, {
				totalActivities: 10,
				categoryBreakdown: { うんどう: 3, べんきょう: 7 },
			}),
		);
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		// べんきょう: 7 * 12 = 84 > うんどう: 3 * 12 = 36
		expect(book.bestCategory).toBe('べんきょう');
	});

	it('ステータスがエラーの場合はlevel=1, title=""にフォールバックする', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) =>
			makeReport(yearMonth),
		);
		vi.mocked(getChildStatus).mockResolvedValue({ error: 'NOT_FOUND' });
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		expect(book.currentLevel).toBe(1);
		expect(book.levelTitle).toBe('');
	});

	it('特定月のレポート取得がエラーでもブック全体は生成される（ゼロページ挿入）', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		let callCount = 0;
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) => {
			callCount++;
			// 3回目の呼び出し（2025-06）でエラーを投げる
			if (callCount === 3) {
				throw new Error('DB connection lost');
			}
			return makeReport(yearMonth, { totalActivities: 10, totalPoints: 100 });
		});
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		// 12ヶ月分のページは存在する
		expect(book.months).toHaveLength(12);

		// エラー月（2025-06）はゼロデータ
		const errorPage = book.months.find((m: MonthPage) => m.month === '2025-06');
		expect(errorPage).toBeDefined();
		expect(errorPage?.totalActivities).toBe(0);
		expect(errorPage?.totalPoints).toBe(0);
		expect(errorPage?.maxStreakDays).toBe(0);

		// 他の11ヶ月は正常データ
		expect(book.totalActivities).toBe(10 * 11);
		expect(book.totalPoints).toBe(100 * 11);
	});

	it('全月のデータがゼロでもブックが正常に生成される', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) =>
			makeReport(yearMonth),
		);
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		expect(book.totalActivities).toBe(0);
		expect(book.totalPoints).toBe(0);
		expect(book.maxStreakDays).toBe(0);
		expect(book.bestMonth).toBeNull();
		expect(book.bestCategory).toBeNull();
		expect(book.months).toHaveLength(12);
	});

	it('証明書の件数がcertificateCountに正しく反映される', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) =>
			makeReport(yearMonth),
		);
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([
			makeCert(1, 'streak_7'),
			makeCert(2, 'streak_14'),
			makeCert(3, 'level_5'),
		]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		expect(book.certificateCount).toBe(3);
		expect(getCertificatesForChild).toHaveBeenCalledWith(CHILD_ID, TENANT);
	});

	it('totalActivities, totalPoints, maxStreakDaysの集計が正しい', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) => {
			const monthNum = Number.parseInt(yearMonth.split('-')[1] ?? '0', 10);
			return makeReport(yearMonth, {
				totalActivities: monthNum, // 4,5,6,...12,1,2,3
				totalPoints: monthNum * 10,
				maxStreakDays: monthNum === 8 ? 15 : 3, // 8月が最大
			});
		});
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		// totalActivities: 4+5+6+7+8+9+10+11+12+1+2+3 = 78
		expect(book.totalActivities).toBe(78);
		// totalPoints: 78 * 10 = 780
		expect(book.totalPoints).toBe(780);
		// maxStreakDays: max(3,...,15,...,3) = 15
		expect(book.maxStreakDays).toBe(15);
	});

	it('bestCategoryは複数カテゴリを跨いで正しく集計される', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		// 前半6ヶ月: うんどう多め、後半6ヶ月: おてつだい多め（合計でおてつだいが勝つ）
		let callIdx = 0;
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) => {
			callIdx++;
			if (callIdx <= 6) {
				return makeReport(yearMonth, {
					totalActivities: 10,
					categoryBreakdown: { うんどう: 8, おてつだい: 2 },
				});
			}
			return makeReport(yearMonth, {
				totalActivities: 10,
				categoryBreakdown: { うんどう: 1, おてつだい: 9 },
			});
		});
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		// うんどう: 8*6 + 1*6 = 54, おてつだい: 2*6 + 9*6 = 66
		expect(book.bestCategory).toBe('おてつだい');
	});

	it('全月でエラーが発生しても空のブックが返る', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockRejectedValue(new Error('DB unavailable'));
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		expect(book.months).toHaveLength(12);
		expect(book.totalActivities).toBe(0);
		expect(book.totalPoints).toBe(0);
		expect(book.maxStreakDays).toBe(0);
		expect(book.bestMonth).toBeNull();
		expect(book.bestCategory).toBeNull();

		// 全ページがゼロデータ
		for (const page of book.months) {
			expect(page.totalActivities).toBe(0);
			expect(page.totalPoints).toBe(0);
		}
	});

	it('bestMonthは活動数0の月は選ばれない', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) => {
			// 1月だけ活動あり
			if (yearMonth === '2026-01') {
				return makeReport(yearMonth, { totalActivities: 1 });
			}
			return makeReport(yearMonth, { totalActivities: 0 });
		});
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		expect(book.bestMonth).toBe('2026-01');
	});

	it('証明書が0件ならcertificateCountは0', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) =>
			makeReport(yearMonth),
		);
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, FISCAL_YEAR, TENANT);
		const book = result as GrowthBookData;

		expect(book.certificateCount).toBe(0);
	});

	it('異なる年度(2024)でも正しい月範囲(2024-04〜2025-03)になる', async () => {
		vi.mocked(getChildById).mockResolvedValue(mockChild);
		vi.mocked(computeDetailedMonthlyReport).mockImplementation(async (_t, _c, _n, yearMonth) =>
			makeReport(yearMonth),
		);
		vi.mocked(getChildStatus).mockResolvedValue(mockStatus);
		vi.mocked(getCertificatesForChild).mockResolvedValue([]);

		const result = await buildGrowthBook(CHILD_ID, '2024', TENANT);
		const book = result as GrowthBookData;

		const expected2024 = [
			'2024-04',
			'2024-05',
			'2024-06',
			'2024-07',
			'2024-08',
			'2024-09',
			'2024-10',
			'2024-11',
			'2024-12',
			'2025-01',
			'2025-02',
			'2025-03',
		];
		const monthStrings = book.months.map((m: MonthPage) => m.month);
		expect(monthStrings).toEqual(expected2024);
		expect(book.fiscalYear).toBe('2024');
	});
});
