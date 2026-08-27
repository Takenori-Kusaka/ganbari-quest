// tests/unit/services/child-activity-copy-service.test.ts
// 兄弟共通化 UX (#2362 PR-3、ADR-0055) unit test
//
// 検証範囲:
//   - 複数 target child に対する一括コピー
//   - #4694 重複 skip: target に同名 + 同カテゴリが既にあれば作らない (2 回押しても増えない)
//   - self-copy 拒否
//   - 1 target が失敗しても他は継続 (partial success)
//   - tenant isolation の引数伝播
//   - 単一 convenience (copyChildActivitiesToSibling) の正常系 / self-copy 例外
//
// #4694: copy の実装を repo (`copyActivitiesAcrossChildren`、backend 3 実装に重複) から
//   service に一本化した。service は findActivitiesByChild + insertActivitiesBulk だけを使う。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asCategoryId, asChildId } from '$lib/domain/ids';

// ---------- Top-level mocks ----------

const mockFindActivitiesByChild = vi.fn();
const mockInsertActivitiesBulk = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childActivity: {
			findActivitiesByChild: (...args: unknown[]) => mockFindActivitiesByChild(...args),
			insertActivitiesBulk: (...args: unknown[]) => mockInsertActivitiesBulk(...args),
		},
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import {
	copyChildActivitiesToSibling,
	copyChildActivitiesToSiblings,
} from '../../../src/lib/server/services/child-activity-copy-service';

const TENANT = 'test-tenant-001';
const SOURCE = asChildId(101);

/** source / target の activity row (service が参照する field のみ)。 */
function activity(name: string, categoryId = 1, extra: Record<string, unknown> = {}) {
	return {
		id: `${name}-id`,
		childId: SOURCE,
		name,
		categoryId: asCategoryId(categoryId),
		icon: '🏃',
		basePoints: 5,
		triggerHint: null,
		isMainQuest: 0,
		sourcePresetId: null,
		priority: 'optional',
		source: 'custom',
		...extra,
	};
}

/**
 * `findActivitiesByChild` を child ごとの返り値でモックする。
 * 未登録 child は空配列 (= その子はまだ何も持っていない)。
 */
function stubChildren(byChild: Record<string, ReturnType<typeof activity>[]>) {
	mockFindActivitiesByChild.mockImplementation(async (childId: string) => byChild[childId] ?? []);
}

beforeEach(() => {
	vi.clearAllMocks();
	stubChildren({});
	// 実 repo と同じく「作成した row」を返す (件数を実 persist から数えるため)
	mockInsertActivitiesBulk.mockImplementation(async (inputs: { name: string }[]) =>
		inputs.map((i, idx) => ({ id: `new-${idx}`, ...i })),
	);
});

// ============================================================
// copyChildActivitiesToSiblings
// ============================================================

describe('copyChildActivitiesToSiblings', () => {
	it('targetChildIds 空 -> totalCopied=0、書き込みは起きない', async () => {
		stubChildren({ [SOURCE]: [activity('A')] });

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [],
		});

		expect(result.totalCopied).toBe(0);
		expect(result.byTargetChild).toEqual({});
		expect(result.errors).toEqual([]);
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
	});

	it('source に activity が無い -> 何も作らない', async () => {
		stubChildren({});

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202)],
		});

		expect(result.totalCopied).toBe(0);
		expect(result.totalSkipped).toBe(0);
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
	});

	it('targets 1 件 -> source 全件を bulk insert、件数集計', async () => {
		stubChildren({ [SOURCE]: [activity('A'), activity('B', 2), activity('C', 3)] });

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202)],
		});

		expect(result.totalCopied).toBe(3);
		expect(result.totalSkipped).toBe(0);
		expect(result.byTargetChild).toEqual({ 202: 3 });
		expect(result.errors).toEqual([]);
		const [inputs, tenantArg] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
		expect(tenantArg).toBe(TENANT);
		expect(inputs).toHaveLength(3);
		expect(inputs[0]).toMatchObject({ childId: '202', name: 'A', source: 'custom' });
	});

	it('targets 3 件 -> 全 target に copy、件数別集計', async () => {
		stubChildren({ [SOURCE]: [activity('A'), activity('B', 2)] });

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202), asChildId(303), asChildId(404)],
		});

		expect(result.totalCopied).toBe(6);
		expect(result.byTargetChild).toEqual({ 202: 2, 303: 2, 404: 2 });
		expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(3);
	});

	// ──────────────────────────────────────────────────────────
	// #4694: 重複 skip (2 回押しても二重登録されない)
	// ──────────────────────────────────────────────────────────

	it('#4694: target に同名 + 同カテゴリが既にある -> skip して作らない', async () => {
		stubChildren({
			[SOURCE]: [activity('そうじ'), activity('しゅくだい', 2)],
			// target は「そうじ」を既に持っている (前回のコピー)
			'202': [activity('そうじ')],
		});

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202)],
		});

		expect(result.totalCopied).toBe(1);
		expect(result.totalSkipped).toBe(1);
		expect(result.skippedByTargetChild).toEqual({ 202: 1 });
		const [inputs] = mockInsertActivitiesBulk.mock.calls[0] ?? [];
		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toMatchObject({ name: 'しゅくだい' });
	});

	it('#4694: 同じコピーを 2 回実行しても件数が増えない (2 回目は全 skip / 書き込み 0)', async () => {
		const sourceList = [activity('そうじ'), activity('しゅくだい', 2)];
		// 1 回目: target は空
		stubChildren({ [SOURCE]: sourceList });
		const first = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202)],
		});
		expect(first.totalCopied).toBe(2);

		// 2 回目: 1 回目でコピーされた 2 件が target に存在する状態
		mockInsertActivitiesBulk.mockClear();
		stubChildren({ [SOURCE]: sourceList, '202': sourceList });
		const second = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202)],
		});

		expect(second.totalCopied).toBe(0);
		expect(second.totalSkipped).toBe(2);
		// 1 件も作らないので bulk insert 自体を呼ばない (無駄な write / quota 消費を出さない)
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
	});

	it('#4694: 同名でもカテゴリが違えば別物としてコピーする', async () => {
		stubChildren({
			[SOURCE]: [activity('よみもの', 2)],
			'202': [activity('よみもの', 5)], // そうぞうカテゴリの同名
		});

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202)],
		});

		expect(result.totalCopied).toBe(1);
		expect(result.totalSkipped).toBe(0);
	});

	it('#4694: source 内に同名 + 同カテゴリが 2 件あっても target には 1 件だけ作る', async () => {
		stubChildren({ [SOURCE]: [activity('そうじ'), activity('そうじ')] });

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202)],
		});

		expect(result.totalCopied).toBe(1);
		expect(result.totalSkipped).toBe(1);
	});

	it('self-copy (source == target) は filter で除外され書き込みゼロ', async () => {
		stubChildren({ [SOURCE]: [activity('A')] });

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [SOURCE],
		});

		expect(result.totalCopied).toBe(0);
		expect(result.byTargetChild).toEqual({});
		expect(result.errors).toEqual([]);
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
	});

	it('source が target に混在 -> source のみ除外、他は処理継続', async () => {
		stubChildren({ [SOURCE]: [activity('A')] });

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [SOURCE, asChildId(202), asChildId(303)],
		});

		expect(result.totalCopied).toBe(2);
		expect(result.byTargetChild).toEqual({ 202: 1, 303: 1 });
		expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(2);
	});

	it('1 target の copy が失敗しても他は継続 (partial success)', async () => {
		stubChildren({ [SOURCE]: [activity('A'), activity('B', 2)] });
		mockInsertActivitiesBulk
			.mockRejectedValueOnce(new Error('child=202 not found'))
			.mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);

		const result = await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202), asChildId(303)],
		});

		expect(result.totalCopied).toBe(2);
		expect(result.byTargetChild).toEqual({ 303: 2 });
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatchObject({
			targetChildId: asChildId(202),
			message: expect.stringContaining('not found'),
		});
	});

	it('tenantId が全 read / write 呼出に伝播する', async () => {
		stubChildren({ [SOURCE]: [activity('A')] });

		await copyChildActivitiesToSiblings({
			tenantId: 'tenant-x',
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202), asChildId(303)],
		});

		for (const call of mockFindActivitiesByChild.mock.calls) {
			expect(call[1]).toBe('tenant-x');
		}
		for (const call of mockInsertActivitiesBulk.mock.calls) {
			expect(call[1]).toBe('tenant-x');
		}
	});

	it('source の読み取りは target 数に関係なく 1 回だけ', async () => {
		stubChildren({ [SOURCE]: [activity('A')] });

		await copyChildActivitiesToSiblings({
			tenantId: TENANT,
			sourceChildId: SOURCE,
			targetChildIds: [asChildId(202), asChildId(303), asChildId(404)],
		});

		const sourceReads = mockFindActivitiesByChild.mock.calls.filter((c) => c[0] === SOURCE);
		expect(sourceReads).toHaveLength(1);
	});
});

// ============================================================
// copyChildActivitiesToSibling (single convenience)
// ============================================================

describe('copyChildActivitiesToSibling', () => {
	it('正常系: コピー件数と skip 件数を返す', async () => {
		stubChildren({
			[SOURCE]: [activity('A'), activity('B', 2)],
			'202': [activity('A')],
		});

		const result = await copyChildActivitiesToSibling(TENANT, SOURCE, asChildId(202));

		expect(result).toEqual({ copied: 1, skipped: 1 });
	});

	it('source == target -> Error を throw', async () => {
		await expect(copyChildActivitiesToSibling(TENANT, SOURCE, SOURCE)).rejects.toThrow(/同一/);
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
	});

	it('repo 例外は呼出側に伝播する', async () => {
		stubChildren({ [SOURCE]: [activity('A')] });
		mockInsertActivitiesBulk.mockRejectedValueOnce(new Error('FK violation'));

		await expect(copyChildActivitiesToSibling(TENANT, SOURCE, asChildId(202))).rejects.toThrow(
			'FK violation',
		);
	});
});
