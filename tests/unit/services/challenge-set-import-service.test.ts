/**
 * tests/unit/services/challenge-set-import-service.test.ts
 *
 * challenge-set service unit tests — Issue #2369 / EPIC #2362 P3
 * #2458-B (caller migration): per-child instance path 必須化 (childIds 必須) に追従。
 *
 * 検証:
 *   - previewChallengeSetImport() の重複検知 (title ベース、child_challenges から) + byCategory 集計
 *   - importChallengeSet() の per-child instance 配信動作 (imported / errors)
 *   - childIds 必須化 (空配列なら error 返却)
 *   - expandChallengeSetDates() の JST date utility 整合
 *   - tenant 強制
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks ----------

const mockFindAllByTenant = vi.fn();
const mockCreateChildChallengesBulk = vi.fn();
const mockBuildPerChildTargets = vi.fn();
const mockFindAllChildren = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: {
			findAllByTenant: (...args: unknown[]) => mockFindAllByTenant(...args),
		},
	}),
}));

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
}));

vi.mock('$lib/server/services/child-challenge-service', () => ({
	createChildChallengesBulk: (...args: unknown[]) => mockCreateChildChallengesBulk(...args),
	buildPerChildTargets: (...args: unknown[]) => mockBuildPerChildTargets(...args),
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
const CHILD_IDS = [101, 102] as const;

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
	mockFindAllByTenant.mockResolvedValue([]);
	mockCreateChildChallengesBulk.mockImplementation((_spec, childIds: readonly number[]) =>
		Promise.resolve(childIds.map((id, i) => ({ id: i + 1, childId: id, title: 'mock' }))),
	);
	mockBuildPerChildTargets.mockImplementation(
		(baseTarget: number, _adj, childIds: readonly number[]) =>
			Promise.resolve(Object.fromEntries(childIds.map((id) => [id, baseTarget]))),
	);
	mockFindAllChildren.mockResolvedValue([
		{ id: 101, age: 5 },
		{ id: 102, age: 8 },
	]);
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
	// =====================================================

	it('UTC 大晦日深夜 (= JST 元旦早朝) は JST 年で判定する (#966 年境界)', () => {
		const today = new Date(Date.UTC(2025, 11, 31, 23, 30));
		const result = expandChallengeSetDates('07-07', 7, today);
		expect(result.endDate).toBe('2026-07-07');
		expect(result.startDate).toBe('2026-07-01');
	});

	it('UTC 日中 (= JST 当日夜) は JST 年で判定する (#966 年境界、上限側)', () => {
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
		mockFindAllByTenant.mockResolvedValue([]);
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

	it('一部 title 重複 → 正しくカウント (child_challenges から検索)', async () => {
		mockFindAllByTenant.mockResolvedValue([{ title: 'A' }]);
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

	it('preview() は createChildChallengesBulk を呼ばない (DB write 禁止)', async () => {
		const challenges = [makeChallenge({ title: 'X' })];
		await previewChallengeSetImport(challenges, TENANT);
		expect(mockCreateChildChallengesBulk).not.toHaveBeenCalled();
	});

	it('tenantId が findAllByTenant に渡される', async () => {
		const challenges = [makeChallenge()];
		await previewChallengeSetImport(challenges, TENANT);
		expect(mockFindAllByTenant).toHaveBeenCalledWith(TENANT);
	});
});

// =====================================================
// importChallengeSet (#2458-B: childIds 必須化)
// =====================================================

describe('importChallengeSet', () => {
	it('全件新規 → imported = 件数 × childIds 数', async () => {
		const challenges = [
			makeChallenge({ title: 'A' }),
			makeChallenge({ title: 'B', categoryId: 2 }),
		];
		const result = await importChallengeSet(challenges, TENANT, { childIds: CHILD_IDS });
		// 2 challenges × 2 children = 4 imported
		expect(result.imported).toBe(4);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockCreateChildChallengesBulk).toHaveBeenCalledTimes(2);
	});

	it('childIds 未指定 / 空配列 → error 返却 + write なし', async () => {
		const challenges = [makeChallenge({ title: 'A' })];
		const result = await importChallengeSet(challenges, TENANT, { childIds: [] });
		expect(result.imported).toBe(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('childIds');
		expect(mockCreateChildChallengesBulk).not.toHaveBeenCalled();
	});

	it('challengeType=cooperative 固定で createChildChallengesBulk に渡る (#2296)', async () => {
		const challenges = [makeChallenge({ title: 'cooperative-only' })];
		const today = new Date(Date.UTC(2026, 0, 1));
		await importChallengeSet(challenges, TENANT, { today, childIds: CHILD_IDS });
		expect(mockCreateChildChallengesBulk).toHaveBeenCalledWith(
			expect.objectContaining({ challengeType: 'cooperative' }),
			CHILD_IDS,
			TENANT,
		);
	});

	it('monthDay/durationDays → startDate/endDate 展開が正しく渡る', async () => {
		const today = new Date(Date.UTC(2026, 0, 1));
		const challenges = [
			makeChallenge({ title: '七夕', monthDay: '07-07', durationDays: 7, categoryId: 5 }),
		];
		await importChallengeSet(challenges, TENANT, { today, childIds: CHILD_IDS });
		expect(mockCreateChildChallengesBulk).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: '2026-07-01',
				endDate: '2026-07-07',
			}),
			CHILD_IDS,
			TENANT,
		);
	});

	it('過去 monthDay (3/3) を 5/19 視点で取込 → 翌年に展開', async () => {
		const today = new Date(Date.UTC(2026, 4, 19));
		const challenges = [makeChallenge({ title: 'ひな祭り 2027', monthDay: '03-03' })];
		await importChallengeSet(challenges, TENANT, { today, childIds: CHILD_IDS });
		expect(mockCreateChildChallengesBulk).toHaveBeenCalledWith(
			expect.objectContaining({
				endDate: '2027-03-03',
			}),
			CHILD_IDS,
			TENANT,
		);
	});

	it('targetConfig / rewardConfig が JSON stringify される', async () => {
		const challenges = [
			makeChallenge({ title: 'cfg', categoryId: 2, baseTarget: 5, rewardPoints: 50 }),
		];
		await importChallengeSet(challenges, TENANT, { childIds: CHILD_IDS });
		const args = mockCreateChildChallengesBulk.mock.calls[0]?.[0] as
			| { targetConfig: string; rewardConfig: string; sourceTemplateId: string }
			| undefined;
		expect(args).toBeDefined();
		if (!args) throw new Error('createChildChallengesBulk was not called');
		expect(JSON.parse(args.targetConfig)).toMatchObject({
			metric: 'count',
			baseTarget: 5,
			categoryId: 2,
		});
		expect(JSON.parse(args.rewardConfig)).toMatchObject({ points: 50 });
		expect(args.sourceTemplateId).toMatch(/^challenge-set:/);
	});

	it('createChildChallengesBulk throw → errors 記録 + 処理継続', async () => {
		mockCreateChildChallengesBulk
			.mockRejectedValueOnce(new Error('DB error'))
			.mockResolvedValueOnce([
				{ id: 2, childId: 101 },
				{ id: 3, childId: 102 },
			]);
		const challenges = [
			makeChallenge({ title: 'failing' }),
			makeChallenge({ title: 'ok', categoryId: 2 }),
		];
		const result = await importChallengeSet(challenges, TENANT, { childIds: CHILD_IDS });
		expect(result.imported).toBe(2);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('failing');
		// #2830 AC1/AC3: 1 challenge の bulk throw で childIds.length (=2) child 行が喪失する。
		//   errors.length は 1 しか積まれないため、failed は errors.length と乖離する。
		expect(result.failed).toBe(CHILD_IDS.length);
		expect(result.failed).toBeGreaterThan(result.errors.length);
	});

	it('#2830 負例: 全 challenge 成功 → failed=0 (false positive を出さない)', async () => {
		const challenges = [makeChallenge({ title: 'A' }), makeChallenge({ title: 'B' })];
		const result = await importChallengeSet(challenges, TENANT, { childIds: CHILD_IDS });
		expect(result.imported).toBe(4);
		expect(result.failed).toBe(0);
		expect(result.errors).toEqual([]);
	});

	it('#2830 負例: childIds 空 → failed=0 (構成エラーは errors のみ)', async () => {
		const result = await importChallengeSet([makeChallenge({ title: 'A' })], TENANT, {
			childIds: [],
		});
		expect(result.failed).toBe(0);
		expect(result.errors).toHaveLength(1);
	});

	it('sourceTemplateId に presetId が埋め込まれる', async () => {
		const challenges = [makeChallenge({ title: 'with-preset' })];
		await importChallengeSet(challenges, TENANT, {
			childIds: CHILD_IDS,
			presetId: 'japan-annual-2026',
		});
		const args = mockCreateChildChallengesBulk.mock.calls[0]?.[0] as
			| { sourceTemplateId: string }
			| undefined;
		expect(args?.sourceTemplateId).toBe('challenge-set:japan-annual-2026:with-preset');
	});

	// #2488 (must-3 fix): N+1 query 解消の回帰防止
	it('複数 challenge の import で findAllChildren は 1 回しか呼ばれない (N+1 解消)', async () => {
		const challenges = [
			makeChallenge({ title: 'A' }),
			makeChallenge({ title: 'B' }),
			makeChallenge({ title: 'C' }),
			makeChallenge({ title: 'D' }),
			makeChallenge({ title: 'E' }),
		];
		await importChallengeSet(challenges, TENANT, { childIds: CHILD_IDS });
		// 旧実装: buildPerChildTargets 内で 5 回 findAllChildren が走っていた
		// 新実装: import service が 1 回だけ呼び、buildPerChildTargets には prefetched を渡す
		expect(mockFindAllChildren).toHaveBeenCalledTimes(1);
		// buildPerChildTargets は loop 内 5 回 mock 呼出されるが、prefetched 配列を渡す形
		expect(mockBuildPerChildTargets).toHaveBeenCalledTimes(5);
		// 5 回全てで 5 番目引数 (prefetched) が渡されている
		for (const call of mockBuildPerChildTargets.mock.calls) {
			expect(call[4]).toEqual([
				{ id: 101, age: 5 },
				{ id: 102, age: 8 },
			]);
		}
	});
});
