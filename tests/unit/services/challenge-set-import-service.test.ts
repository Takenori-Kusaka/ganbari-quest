/**
 * tests/unit/services/challenge-set-import-service.test.ts
 *
 * challenge-set service unit tests — Issue #2369 / EPIC #2362 P3
 *
 * 検証:
 *   - previewChallengeSetImport() の重複検知 (title ベース) + byCategory 集計
 *   - importChallengeSet() の merge 動作 (skipped / imported / errors)
 *   - createSiblingChallenge への展開後 startDate / endDate 伝播
 *   - tenant 強制 (findAllChallenges に tenantId 伝播)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks ----------

const mockFindAllChallenges = vi.fn();
const mockCreateSiblingChallenge = vi.fn();

vi.mock('$lib/server/db/sibling-challenge-repo', () => ({
	findAllChallenges: (...args: unknown[]) => mockFindAllChallenges(...args),
}));

vi.mock('$lib/server/services/sibling-challenge-service', () => ({
	createSiblingChallenge: (...args: unknown[]) => mockCreateSiblingChallenge(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import {
	expandChallengeSetDates,
	importChallengeSet,
	previewChallengeSetImport,
} from '../../../src/lib/server/services/challenge-set-import-service';

const TENANT = 'test-tenant-001';

interface ChallengeFixture {
	title: string;
	description: string;
	monthDay: string;
	durationDays: number;
	categoryId: 1 | 2 | 3 | 4 | 5;
	baseTarget: number;
	rewardPoints: number;
	icon: string;
}

function makeChallenge(overrides: Partial<ChallengeFixture> = {}): ChallengeFixture {
	return {
		title: 'ひな祭り大そうじ',
		description: 'ひな人形の飾りつけ・お部屋のお片付け',
		monthDay: '03-03',
		durationDays: 3,
		categoryId: 3,
		baseTarget: 3,
		rewardPoints: 30,
		icon: '🎎',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindAllChallenges.mockResolvedValue([]);
	mockCreateSiblingChallenge.mockResolvedValue({ id: 1, title: 'mock', startDate: '2026-01-01' });
});

// =====================================================
// expandChallengeSetDates
// =====================================================

describe('expandChallengeSetDates', () => {
	it('未来日付なら今年の同月日', () => {
		const today = new Date(Date.UTC(2026, 0, 1));
		const result = expandChallengeSetDates('07-07', 7, today);
		expect(result.endDate).toBe('2026-07-07');
		expect(result.startDate).toBe('2026-07-01');
	});

	it('過去日付なら来年扱い (#966 JST date-utils SSOT: 翌年実日付に展開)', () => {
		const today = new Date(Date.UTC(2026, 4, 19));
		const result = expandChallengeSetDates('03-03', 3, today);
		expect(result.endDate).toBe('2027-03-03');
		expect(result.startDate).toBe('2027-03-01');
	});

	it('不正フォーマットで throw', () => {
		expect(() => expandChallengeSetDates('invalid', 7, new Date())).toThrow();
	});

	// =====================================================
	// Lambda UTC 環境の年境界バグ回帰テスト (#966 / QM CHANGES_REQUESTED)
	//
	// Lambda は UTC で稼働するため、0:00-9:00 JST (= 15:00-24:00 UTC 前日) の
	// 時間帯に Date.getFullYear() / toISOString() を直接使うと年判定が 1 年ずれる。
	// toJSTDateString() (date-utils.ts SSOT) 経由で JST 年を抽出して回避する。
	// =====================================================

	it('UTC 大晦日深夜 (= JST 元旦早朝) は JST 年で判定する (#966 年境界)', () => {
		// 2025-12-31 23:30 UTC = 2026-01-01 08:30 JST
		// 旧実装の today.getFullYear() は 2025 を返すが、JST 基準では 2026
		const today = new Date(Date.UTC(2025, 11, 31, 23, 30));
		// monthDay '07-07' は JST 2026-01-01 より未来 → 2026-07-07 にならねばならない
		const result = expandChallengeSetDates('07-07', 7, today);
		expect(result.endDate).toBe('2026-07-07');
		expect(result.startDate).toBe('2026-07-01');
	});

	it('UTC 日中 (= JST 当日夜) は JST 年で判定する (#966 年境界、上限側)', () => {
		// 2026-01-01 14:00 UTC = 2026-01-01 23:00 JST (JST 当日の 23 時)
		// JST 基準の今日は 2026-01-01。monthDay '03-03' は未来 → 2026-03-03
		const today = new Date(Date.UTC(2026, 0, 1, 14, 0));
		const result = expandChallengeSetDates('03-03', 3, today);
		expect(result.endDate).toBe('2026-03-03');
		expect(result.startDate).toBe('2026-03-01');
	});
});

// =====================================================
// previewChallengeSetImport
// =====================================================

describe('previewChallengeSetImport', () => {
	it('既存 0 件 → 全て新規としてカウント', async () => {
		mockFindAllChallenges.mockResolvedValue([]);
		const challenges = [
			makeChallenge({ title: 'A', categoryId: 1 }),
			makeChallenge({ title: 'B', categoryId: 2 }),
		];
		const preview = await previewChallengeSetImport(challenges, TENANT);
		expect(preview.total).toBe(2);
		expect(preview.newChallenges).toBe(2);
		expect(preview.duplicates).toBe(0);
		expect(preview.duplicateNames).toEqual([]);
	});

	it('一部 title 重複 → 正しくカウント', async () => {
		mockFindAllChallenges.mockResolvedValue([{ title: 'A' }]);
		const challenges = [
			makeChallenge({ title: 'A' }),
			makeChallenge({ title: 'B', categoryId: 2 }),
		];
		const preview = await previewChallengeSetImport(challenges, TENANT);
		expect(preview.total).toBe(2);
		expect(preview.newChallenges).toBe(1);
		expect(preview.duplicates).toBe(1);
		expect(preview.duplicateNames).toEqual(['A']);
	});

	it('byCategory が集計される (categoryId → カテゴリコード)', async () => {
		const challenges = [
			makeChallenge({ title: 'a1', categoryId: 1 }),
			makeChallenge({ title: 'a2', categoryId: 1 }),
			makeChallenge({ title: 'b1', categoryId: 2 }),
			makeChallenge({ title: 'c1', categoryId: 5 }),
		];
		const preview = await previewChallengeSetImport(challenges, TENANT);
		expect(preview.byCategory).toEqual({ undou: 2, benkyou: 1, souzou: 1 });
	});

	it('preview() は createSiblingChallenge を呼ばない (DB write 禁止)', async () => {
		const challenges = [makeChallenge({ title: 'X' })];
		await previewChallengeSetImport(challenges, TENANT);
		expect(mockCreateSiblingChallenge).not.toHaveBeenCalled();
	});

	it('tenantId が findAllChallenges に渡される', async () => {
		const challenges = [makeChallenge()];
		await previewChallengeSetImport(challenges, TENANT);
		expect(mockFindAllChallenges).toHaveBeenCalledWith(TENANT);
	});
});

// =====================================================
// importChallengeSet
// =====================================================

describe('importChallengeSet', () => {
	it('全件新規 → imported=件数, skipped=0', async () => {
		const challenges = [
			makeChallenge({ title: 'A' }),
			makeChallenge({ title: 'B', categoryId: 2 }),
		];
		const result = await importChallengeSet(challenges, TENANT);
		expect(result.imported).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockCreateSiblingChallenge).toHaveBeenCalledTimes(2);
	});

	it('既存 title と重複 → skipped=重複件数', async () => {
		mockFindAllChallenges.mockResolvedValue([{ title: 'A' }]);
		const challenges = [
			makeChallenge({ title: 'A' }),
			makeChallenge({ title: 'B', categoryId: 2 }),
		];
		const result = await importChallengeSet(challenges, TENANT);
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(mockCreateSiblingChallenge).toHaveBeenCalledTimes(1);
	});

	it('challengeType=cooperative 固定で createSiblingChallenge に渡る (#2296)', async () => {
		const challenges = [makeChallenge({ title: 'cooperative-only' })];
		const today = new Date(Date.UTC(2026, 0, 1));
		await importChallengeSet(challenges, TENANT, { today });
		expect(mockCreateSiblingChallenge).toHaveBeenCalledWith(
			expect.objectContaining({ challengeType: 'cooperative' }),
			TENANT,
		);
	});

	it('monthDay/durationDays → startDate/endDate 展開が正しく渡る', async () => {
		const today = new Date(Date.UTC(2026, 0, 1));
		const challenges = [
			makeChallenge({ title: '七夕', monthDay: '07-07', durationDays: 7, categoryId: 5 }),
		];
		await importChallengeSet(challenges, TENANT, { today });
		expect(mockCreateSiblingChallenge).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: '2026-07-01',
				endDate: '2026-07-07',
			}),
			TENANT,
		);
	});

	it('過去 monthDay (3/3) を 5/19 視点で取込 → 翌年に展開', async () => {
		const today = new Date(Date.UTC(2026, 4, 19));
		const challenges = [makeChallenge({ title: 'ひな祭り 2027', monthDay: '03-03' })];
		await importChallengeSet(challenges, TENANT, { today });
		expect(mockCreateSiblingChallenge).toHaveBeenCalledWith(
			expect.objectContaining({
				endDate: '2027-03-03',
			}),
			TENANT,
		);
	});

	it('targetConfig / rewardConfig が JSON stringify される', async () => {
		const challenges = [
			makeChallenge({ title: 'cfg', categoryId: 2, baseTarget: 5, rewardPoints: 50 }),
		];
		await importChallengeSet(challenges, TENANT);
		const args = mockCreateSiblingChallenge.mock.calls[0]?.[0] as
			| { targetConfig: string; rewardConfig: string }
			| undefined;
		expect(args).toBeDefined();
		if (!args) throw new Error('createSiblingChallenge was not called');
		expect(JSON.parse(args.targetConfig)).toMatchObject({
			metric: 'count',
			baseTarget: 5,
			categoryId: 2,
		});
		expect(JSON.parse(args.rewardConfig)).toMatchObject({ points: 50 });
	});

	it('createSiblingChallenge throw → errors に記録 + 処理継続', async () => {
		mockCreateSiblingChallenge
			.mockRejectedValueOnce(new Error('DB error'))
			.mockResolvedValueOnce({ id: 2 });
		const challenges = [
			makeChallenge({ title: 'failing' }),
			makeChallenge({ title: 'ok', categoryId: 2 }),
		];
		const result = await importChallengeSet(challenges, TENANT);
		expect(result.imported).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('failing');
	});

	it('tenantId が findAllChallenges に渡される', async () => {
		const challenges = [makeChallenge()];
		await importChallengeSet(challenges, TENANT);
		expect(mockFindAllChallenges).toHaveBeenCalledWith(TENANT);
	});

	it('インポート結果 invariant: imported + skipped <= total (errors を含めて total と一致)', async () => {
		mockCreateSiblingChallenge
			.mockResolvedValueOnce({ id: 1 })
			.mockRejectedValueOnce(new Error('err'))
			.mockResolvedValueOnce({ id: 3 });
		const challenges = [
			makeChallenge({ title: 'ok1' }),
			makeChallenge({ title: 'fail' }),
			makeChallenge({ title: 'ok2', categoryId: 2 }),
		];
		const result = await importChallengeSet(challenges, TENANT);
		expect(result.imported + result.skipped + result.errors.length).toBe(challenges.length);
	});
});
