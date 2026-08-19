// tests/unit/services/activity-quota-import-enforcement.test.ts (#4693)
//
// AC1: 無料プランの上限に達した状態で **どの取込経路から入れても** 上限を超えない。
//
// 旧実装は上限判定を各 route の action が個別に呼ぶ形で、ファイル復元 (`?/importFile`) にだけ
// gate が無かった。無料プラン (maxActivities=3) で 3/3 のテナントが JSON/CSV を復元すると
// 119 件が入り「たろう (122)」になった (#4693 実測)。取込の実書き込み直前で切る。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { asChildId } from '$lib/domain/ids';

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

const TENANT = 'tenant-1';
const CHILD = asChildId(1);

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
		expect(result.errors.join(' ')).toContain('3');
	});

	it('残枠 1 件 → 1 件だけ入り、残りは弾かれる (余裕のある分は入る)', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindActivitiesByChild.mockResolvedValue(existing(2));

		const result = await importActivities(pack(5), TENANT, { childIds: [CHILD] });

		expect(result.imported).toBe(1);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it('有料プラン (上限なし) は従来どおり全件入る', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'active', plan: 'monthly' });
		mockFindActivitiesByChild.mockResolvedValue(existing(3));

		const result = await importActivities(pack(10), TENANT, { childIds: [CHILD] });

		expect(result.imported).toBe(10);
		expect(result.errors).toEqual([]);
	});

	it('上限内の取込では quota 判定が結果に影響しない', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
		mockFindActivitiesByChild.mockResolvedValue(existing(0));

		const result = await importActivities(pack(2), TENANT, { childIds: [CHILD] });

		expect(result.imported).toBe(2);
		expect(result.errors).toEqual([]);
	});
});
