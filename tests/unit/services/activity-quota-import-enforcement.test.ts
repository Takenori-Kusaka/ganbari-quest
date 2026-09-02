// tests/unit/services/activity-quota-import-enforcement.test.ts (#4693)
//
// AC1: 無料プランの上限に達した状態で **どの取込経路から入れても** 上限を超えない。
//
// 旧実装は上限判定を各 route の action が個別に呼ぶ形で、ファイル復元 (`?/importFile`) にだけ
// gate が無かった。無料プラン (maxActivities=3) で 3/3 のテナントが JSON/CSV を復元すると
// 119 件が入り「たろう (122)」になった (#4693 実測)。取込の実書き込み直前で切る。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { asCategoryId, asChildId, type ChildId } from '$lib/domain/ids';
import type { InsertChildActivityInput } from '$lib/server/db/types';

const mockFindAllChildren = vi.fn();
const mockFindActivitiesByChild = vi.fn();
const mockInsertActivitiesBulk = vi.fn();
const mockResolveTenantEntitlement = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
		childActivity: {
			findActivitiesByChild: mockFindActivitiesByChild,
			insertActivitiesBulk: mockInsertActivitiesBulk,
		},
	}),
}));

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
}));

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: vi.fn(async () => []),
}));

vi.mock('$lib/server/auth/tenant-entitlement', () => ({
	resolveTenantEntitlement: (...args: unknown[]) => mockResolveTenantEntitlement(...args),
}));

// #4723: モード判定の実体は auth-mode.ts (factory は re-export)。plan-limit-service は
// 実体を直接 import するため、両方を差し替えないと selfhost 扱い (上限なし) になる。
vi.mock('$lib/server/auth/auth-mode', () => ({
	getAuthMode: () => 'cognito',
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: async () => ({
		isTrialActive: false,
		trialUsed: false,
		trialStartDate: null,
		trialEndDate: null,
		trialTier: null,
		daysRemaining: 0,
		source: null,
		convertedToPaid: false,
	}),
}));

import { importActivities } from '$lib/server/services/activity-import-service';
import { enforceActivityQuota } from '$lib/server/services/activity-quota';

const TENANT = 'tenant-1';
const CHILD = asChildId(1);
const SIBLING = asChildId(2);
const CAT = asCategoryId(2);

/** insertActivitiesBulk に渡された **行数** の合計 (child × activity)。 */
function writtenRowCount(): number {
	return mockInsertActivitiesBulk.mock.calls.reduce(
		(n, call) => n + (call[0] as unknown[]).length,
		0,
	);
}

function pack(count: number): ActivityPackItem[] {
	return Array.from({ length: count }, (_, i) => ({
		name: `復元活動${i + 1}`,
		categoryCode: 'benkyou' as const,
		icon: '📚',
		basePoints: 5,
		ageMin: null,
		ageMax: null,
		gradeLevel: null,
	}));
}

/** 既存のカスタム活動 n 件 (quota に数える source='custom') */
function existing(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		id: String(i + 1),
		name: `既存${i + 1}`,
		source: 'custom',
		isArchived: 0,
	}));
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindAllChildren.mockResolvedValue([{ id: CHILD, nickname: 'たろう' }]);
	mockInsertActivitiesBulk.mockImplementation(async (inputs: { name: string }[]) =>
		inputs.map((i) => ({ name: i.name })),
	);
});

describe('#4693 取込の上限は importActivities で一元強制される', () => {
	it('無料プランで 3/3 到達 → 復元しても 1 件も増えず、理由が errors に出る', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindActivitiesByChild.mockResolvedValue(existing(3)); // free の maxActivities=3

		const result = await importActivities(pack(119), TENANT, { childIds: [CHILD] });

		expect(result.imported).toBe(0);
		expect(mockInsertActivitiesBulk).not.toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ name: '復元活動1' })]),
			expect.anything(),
		);
		// #4693 fix: 理由は errors (表示ログ) ではなく blocked (顧客に見せる channel) に載る。
		expect(result.blocked?.message).toContain('3');
		expect(result.blocked?.count).toBe(119);
		expect(result.blocked?.upgradeUrl).toBe('/admin/subscription');
	});

	it('残枠 1 件 → 1 件だけ入り、残りは弾かれる (余裕のある分は入る)', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindActivitiesByChild.mockResolvedValue(existing(2));

		const result = await importActivities(pack(5), TENANT, { childIds: [CHILD] });

		expect(result.imported).toBe(1);
		expect(result.blocked?.count).toBe(4);
	});

	it('有料プラン (上限なし) は従来どおり全件入る', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'active', plan: 'monthly' });
		mockFindActivitiesByChild.mockResolvedValue(existing(3));

		const result = await importActivities(pack(10), TENANT, { childIds: [CHILD] });

		expect(result.imported).toBe(10);
		expect(result.errors).toEqual([]);
		expect(result.blocked).toBeUndefined();
	});

	it('上限内の取込では quota 判定が結果に影響しない', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindActivitiesByChild.mockResolvedValue(existing(0));

		const result = await importActivities(pack(2), TENANT, { childIds: [CHILD] });

		expect(result.imported).toBe(2);
		expect(result.errors).toEqual([]);
		expect(result.blocked).toBeUndefined();
	});

	// #4693 fix (adversarial D1): quota の単位は **行数** (`checkActivityLimit` と同じ)。
	// 名前の集合数で残枠と比べると、同じ 3 名を 2 人の子に取り込んだとき `3 <= 3` を
	// 素通りして **6 行** 書かれ、上限 3 のテナントが 6 件保持できてしまう。
	it('子供 2 人 × 同じ 3 件でも、書かれる行数が上限 3 を超えない', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindAllChildren.mockResolvedValue([
			{ id: CHILD, nickname: 'たろう' },
			{ id: SIBLING, nickname: 'はなこ' },
		]);
		mockFindActivitiesByChild.mockResolvedValue(existing(0));

		const result = await importActivities(pack(3), TENANT, { childIds: [CHILD, SIBLING] });

		expect(writtenRowCount()).toBeLessThanOrEqual(3);
		expect(result.blocked?.count).toBeGreaterThan(0);
	});

	// 既に 2 行使っているテナントに 2 人分を取り込む: 1 名 = 2 行 > 残枠 1 なので 1 行も入らない。
	it('残枠 1 行に対し 1 件が 2 行を要する場合は 1 行も書かれない', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindAllChildren.mockResolvedValue([
			{ id: CHILD, nickname: 'たろう' },
			{ id: SIBLING, nickname: 'はなこ' },
		]);
		// 2 人合計で 2 行使用済 (free の maxActivities=3 に対し残枠 1)
		mockFindActivitiesByChild.mockResolvedValue(existing(1));

		const result = await importActivities(pack(2), TENANT, { childIds: [CHILD, SIBLING] });

		expect(writtenRowCount()).toBe(0);
		expect(result.imported).toBe(0);
		expect(result.blocked?.count).toBe(4);
	});
	// ------------------------------------------------------------------
	// #4693 QM: gate が数える母集団と、制限する母集団を一致させる
	//
	// 旧実装は取込を全部 repo 既定 `seed` で書きつつ、gate は custom quota で判定していた。
	// その結果 (a) 取込行が current を増やさず繰り返せば上限を超え、
	// (b) 手動作成だけで上限に達した世帯がプリセット取込まで恒久的に拒否された。
	// ------------------------------------------------------------------

	it('ファイル復元 (presetId 無し) は custom として書かれ、quota を消費する', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindActivitiesByChild.mockResolvedValue(existing(0));

		await importActivities(pack(2), TENANT, { childIds: [CHILD] });

		const written = mockInsertActivitiesBulk.mock.calls.flatMap(
			(call) => call[0] as { source?: string }[],
		);
		expect(written.length).toBe(2);
		for (const row of written) {
			expect(row.source, '親が自分で用意した取込は手動作成と同じ custom で数える').toBe('custom');
		}
	});

	it('プリセット取込 (presetId あり) は seed で書かれ、quota を消費しない', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindActivitiesByChild.mockResolvedValue(existing(0));

		await importActivities(pack(2), TENANT, { childIds: [CHILD], presetId: 'pack-1' });

		const written = mockInsertActivitiesBulk.mock.calls.flatMap(
			(call) => call[0] as { source?: string }[],
		);
		expect(written.length).toBe(2);
		for (const row of written) {
			expect(row.source, 'プリセットは配布物なので quota 非対象 (activity-source.ts の方針)').toBe(
				'seed',
			);
		}
	});

	it('手動 3/3 で上限到達でも、プリセット取込 (seed 行) は strategy 層の quota では切らない (#3669 SSOT / LP「プリセットは無料」)', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindActivitiesByChild.mockResolvedValue(existing(3)); // free の maxActivities=3 に到達

		const result = await importActivities(pack(5), TENANT, {
			childIds: [CHILD],
			presetId: 'pack-1',
		});

		// quota の母集団は custom (activity-source.ts #3669)。seed 行を数えると 10 件の活動セットや
		// 初期 seed 20 件を含む backup 全体復元が「残枠 3 行」で切り詰められ、LP の
		// 「プリセットを使って無料で始められます」と食い違う。admin 画面での 3/3 到達時の
		// テンプレ取込 403 は action 側の checkActivityLimit が担う (本関数の責務ではない)。
		expect(result.imported).toBe(5);
		expect(result.blocked).toBeUndefined();
	});

	it('custom 行と seed 行が混ざる計画 (backup 全体復元) は custom 行だけを残枠と比べる', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindActivitiesByChild.mockResolvedValue(existing(2)); // 残枠 1

		const childInputsByChild = new Map<ChildId, InsertChildActivityInput[]>([
			[
				CHILD,
				[
					{
						childId: CHILD,
						name: 'seed-a',
						categoryId: CAT,
						icon: '🌱',
						basePoints: 1,
						source: 'seed',
					},
					{
						childId: CHILD,
						name: 'seed-b',
						categoryId: CAT,
						icon: '🌱',
						basePoints: 1,
						source: 'seed',
					},
					{
						childId: CHILD,
						name: 'custom-1',
						categoryId: CAT,
						icon: '✏️',
						basePoints: 1,
						source: 'custom',
					},
					{
						childId: CHILD,
						name: 'custom-2',
						categoryId: CAT,
						icon: '✏️',
						basePoints: 1,
						source: 'custom',
					},
				],
			],
		]);
		const planned = new Set(['seed-a', 'seed-b', 'custom-1', 'custom-2']);
		const quota = await enforceActivityQuota(TENANT, childInputsByChild, planned);

		// seed 2 行はそのまま、custom は残枠 1 に収まる 1 件だけ残る
		expect(quota.rejectedRows).toBe(1);
		expect([...quota.rejectedNames]).toEqual(['custom-2']);
		expect(childInputsByChild.get(CHILD)?.map((i) => i.name)).toEqual([
			'seed-a',
			'seed-b',
			'custom-1',
		]);
		expect(planned.has('custom-2')).toBe(false);
	});

	it('現在数の取得に失敗したときも fail-closed で全件止め、再試行の文言を返す (500 に突き抜けない)', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		// 1 回目 (取込側の既存名 dedup) は成功、2 回目 (quota の現在数) で落とす
		mockFindActivitiesByChild
			.mockResolvedValueOnce(existing(0))
			.mockRejectedValueOnce(new Error('OCC 40001'));

		const result = await importActivities(pack(2), TENANT, { childIds: [CHILD] });
		expect(result.imported).toBe(0);
		expect(result.blocked?.count).toBe(2);
		expect(result.blocked?.upgradeUrl).toBeNull();
	});

	it('ファイル復元を繰り返しても累積で上限を超えない', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		// 1 回目: 0 件から 2 件入る
		mockFindActivitiesByChild.mockResolvedValue(existing(0));
		const first = await importActivities(pack(2), TENANT, { childIds: [CHILD] });
		expect(first.imported).toBe(2);

		// 2 回目: 1 回目で入った 2 件が custom として数えられている状態 (残枠 1)
		mockFindActivitiesByChild.mockResolvedValue([
			{ id: '1', name: '復元活動1', source: 'custom', isArchived: 0 },
			{ id: '2', name: '復元活動2', source: 'custom', isArchived: 0 },
		]);
		const second = await importActivities(
			[
				{
					name: '別の活動A',
					categoryCode: 'benkyou' as const,
					icon: '📚',
					basePoints: 5,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
				},
				{
					name: '別の活動B',
					categoryCode: 'benkyou' as const,
					icon: '📚',
					basePoints: 5,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
				},
			],
			TENANT,
			{ childIds: [CHILD] },
		);
		expect(second.imported, '残枠 1 なので 1 件だけ入る').toBe(1);
		expect(second.blocked?.count).toBe(1);
	});
});
