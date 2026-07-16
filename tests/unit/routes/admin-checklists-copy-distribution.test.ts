// tests/unit/routes/admin-checklists-copy-distribution.test.ts
// #3098: /admin/checklists の copyDistributionFromChild action plan-limit over-grant 根治テスト (QM BLOCK 対応)
//
// テスト観点:
// - Free で target 2/3、source 5 件 distinct → 残スロット 1 件のみ copy (3/3 到達)、残りは skip (over-grant なし)
// - Free で target 既に 3/3 到達 → 1 件も copy せず 403 + upgradeRequired
// - 無制限プラン (standard) → source 全件 copy (cap なし)
// - per-child カウントが max を超えない (over-grant ゼロ)
// - source が既配信のみ → added 0 (distributeToChildren が skip)
// - CWE-598: tenant 外 child は 403 (tenant guard が壊れていない)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildId } from '$lib/domain/ids';

// #3474 item 3: 拒否 path の監査 log を assert するため logger を spy 化する。
const mockLoggerWarn = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
vi.mock('$lib/server/logger', () => ({
	logger: {
		warn: (...a: unknown[]) => mockLoggerWarn(...a),
		info: (...a: unknown[]) => mockLoggerInfo(...a),
		error: (...a: unknown[]) => mockLoggerError(...a),
	},
}));

const mockResolveFullPlanTier = vi.fn();
const mockGetAllChildren = vi.fn();
const mockFindAssignmentsByChild = vi.fn();
const mockDistributeToChildren = vi.fn();

vi.mock('$lib/server/services/checklist-service', () => ({
	createTemplate: vi.fn(),
	editTemplate: vi.fn(),
	removeTemplate: vi.fn(),
	addTemplateItem: vi.fn(),
	removeTemplateItem: vi.fn(),
	addOverride: vi.fn(),
	removeOverride: vi.fn(),
	VALID_TIME_SLOTS: ['morning', 'afternoon', 'evening', 'anytime'],
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: vi.fn(),
	findTemplateItems: vi.fn(),
	findOverrides: vi.fn(),
	findAssignmentsByChild: (...args: unknown[]) => mockFindAssignmentsByChild(...args),
	findAssignmentsByTemplate: vi.fn(),
	findTodayLog: vi.fn(),
	findTemplatesByTenant: vi.fn(),
}));

vi.mock('$lib/server/services/checklist-distribution-service', () => ({
	distributeToChildren: (...args: unknown[]) => mockDistributeToChildren(...args),
	syncDistribution: vi.fn(),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

// plan-limit-service: 実装の振る舞いを薄く再現する。
// checkChecklistTemplateLimit は { allowed, current, max } を返す。
// max=null は無制限プラン (standard 以上)。free は max=3。
// current は mockRepoFindTemplatesByChild の長さ (= target child の per-child テンプレ数)。
const mockRepoFindTemplatesByChild = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		checklist: { findTemplatesByChild: mockRepoFindTemplatesByChild },
	}),
}));

const FREE_MAX = 3;
vi.mock('$lib/server/services/plan-limit-service', async () => {
	return {
		resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
		isPaidTier: (tier: string) => tier === 'standard' || tier === 'family',
		getPlanLimits: (tier: string) => {
			if (tier === 'free') return { maxChecklistTemplates: FREE_MAX };
			return { maxChecklistTemplates: null };
		},
		checkChecklistTemplateLimit: async (
			_tenantId: string,
			_licenseStatus: string,
			childId: ChildId,
		) => {
			const tier = await mockResolveFullPlanTier();
			if (tier !== 'free') return { allowed: true, current: 0, max: null };
			const templates = await mockRepoFindTemplatesByChild(childId, 't-test', true);
			const current = templates.length;
			return { allowed: current < FREE_MAX, current, max: FREE_MAX };
		},
	};
});

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

const { actions } = await import('../../../src/routes/(parent)/admin/checklists/+page.server');

// ---------- Helpers ----------

function createRequest(formValues: Record<string, string>): Request {
	const fd = new FormData();
	for (const [k, v] of Object.entries(formValues)) fd.set(k, v);
	return {
		formData: () => Promise.resolve(fd),
	} as unknown as Request;
}

function createEvent(
	formValues: Record<string, string>,
	options: {
		tenantId?: string;
		licenseStatus?: string;
		identity?: { type: string; userId?: string };
	} = {},
) {
	return {
		request: createRequest(formValues),
		locals: {
			context: {
				tenantId: options.tenantId ?? 't-test',
				licenseStatus: options.licenseStatus ?? 'none',
				role: 'owner',
			},
			identity: options.identity,
		},
	} as unknown as Parameters<NonNullable<typeof actions.copyDistributionFromChild>>[0];
}

// #3181 item1 (TOCTOU 緩和): 実装は各 grant 直前に checkChecklistTemplateLimit を live で再評価する。
// テスト mock も「target child の per-child テンプレ数が insert ごとに増える」 live DB を模す
// (静的 count では re-count 化した実装の挙動を検証できない = mock fidelity)。
let liveTargetCount = 0;

/** target child の現在のテンプレ数 (= per-child quota の current) を設定する。 */
function setTargetInitialCount(n: number) {
	liveTargetCount = n;
	mockRepoFindTemplatesByChild.mockImplementation(async () =>
		Array.from({ length: liveTargetCount }, (_unused, i) => ({ id: `1000${i}` })),
	);
}

/** distributeToChildren を「単一 target child・既配信 skip」の実挙動で stub する。
 * assignedTemplateIds に含まれる templateId は inserted 0 件 (skip)、それ以外は呼ばれた childIds を返す。
 * 実 insert 時は liveTargetCount を +1 し、後続の checkChecklistTemplateLimit re-count に反映させる。 */
function stubDistribute(assignedTemplateIds: Set<number>) {
	mockDistributeToChildren.mockImplementation(
		async (templateId: string, childIds: readonly ChildId[]) => {
			if (assignedTemplateIds.has(Number(templateId))) return [];
			liveTargetCount += 1; // live DB に 1 件追加された
			return [...childIds]; // = [targetChildId]
		},
	);
}

const TENANT_CHILDREN = [{ id: '1' }, { id: '2' }, { id: '3' }];

beforeEach(() => {
	vi.clearAllMocks();
	liveTargetCount = 0;
	mockGetAllChildren.mockResolvedValue(TENANT_CHILDREN);
});

describe('POST /admin/checklists?/copyDistributionFromChild — plan-limit over-grant 根治 (#3098)', () => {
	it('Free target 2/3 + source 5 件 distinct → 1 件のみ copy (3/3)、残り skip / over-grant なし', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		// target child(2) は現在 2 件 (2/3)
		setTargetInitialCount(2);
		// source child(1) は 5 件配信済 (target には未配信なので distribute で全部 insert 候補)
		mockFindAssignmentsByChild.mockResolvedValue([
			{ templateId: 200 },
			{ templateId: 201 },
			{ templateId: 202 },
			{ templateId: 203 },
			{ templateId: 204 },
		]);
		stubDistribute(new Set()); // target には未配信 → 全 distribute が insert を返す

		const result = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '2' }),
		)) as {
			copiedFromChild: boolean;
			added: number;
			dropped?: number;
			limitReached?: boolean;
			message?: string;
		};

		// 残スロット = 3 - 2 = 1 件のみ copy
		expect(result.added).toBe(1);
		expect(result.limitReached).toBe(true);
		expect(result.message).toContain('1 件取り込みました');
		// #3181 item2: drop 件数 (5 - 1 = 4) を明示
		expect(result.dropped).toBe(4);
		expect(result.message).toContain('4 件は取り込めませんでした');
		// distributeToChildren は残スロット 1 件で打ち切り (2 回目以降を呼ばない = over-grant 防止)
		expect(mockDistributeToChildren).toHaveBeenCalledTimes(1);
		// per-child カウント (current 2 + added 1 = 3) が max(3) を超えない
		const finalCount = 2 + result.added;
		expect(finalCount).toBeLessThanOrEqual(FREE_MAX);
	});

	it('Free target 既に 3/3 到達 → 1 件も copy せず 403 + upgradeRequired', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		setTargetInitialCount(3); // 3/3
		mockFindAssignmentsByChild.mockResolvedValue([{ templateId: 200 }]);

		const result = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '2' }),
		)) as { status: number; data: { upgradeRequired: boolean } };

		expect(result.status).toBe(403);
		expect(result.data.upgradeRequired).toBe(true);
		expect(mockDistributeToChildren).not.toHaveBeenCalled();
		expect(mockFindAssignmentsByChild).not.toHaveBeenCalled();
	});

	it('無制限プラン (standard) → source 全件 copy (cap なし)', async () => {
		mockResolveFullPlanTier.mockResolvedValue('standard');
		mockFindAssignmentsByChild.mockResolvedValue([
			{ templateId: 200 },
			{ templateId: 201 },
			{ templateId: 202 },
			{ templateId: 203 },
			{ templateId: 204 },
		]);
		stubDistribute(new Set());

		const result = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '2' }, { licenseStatus: 'active' }),
		)) as { copiedFromChild: boolean; added: number; limitReached?: boolean };

		expect(result.added).toBe(5);
		expect(result.limitReached).toBeUndefined();
		expect(mockDistributeToChildren).toHaveBeenCalledTimes(5);
		// 無制限プランは per-child カウントチェックなし (max=null)
		expect(mockRepoFindTemplatesByChild).not.toHaveBeenCalled();
	});

	it('Free target 0/3 + source の一部が既配信 → 既配信 skip 分を残スロットから消費しない', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		setTargetInitialCount(0); // 0/3 → 残スロット 3
		mockFindAssignmentsByChild.mockResolvedValue([
			{ templateId: 200 }, // 既配信 → insert 0
			{ templateId: 201 }, // 新規 → insert 1
			{ templateId: 202 }, // 既配信 → insert 0
			{ templateId: 203 }, // 新規 → insert 1
			{ templateId: 204 }, // 新規 → insert 1 (ここで残スロット 3 到達)
		]);
		stubDistribute(new Set([200, 202])); // 200/202 は target に既配信

		const result = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '2' }),
		)) as { added: number; limitReached?: boolean };

		// 実 insert は 3 件 (201/203/204)。残スロット 3 に収まるため limitReached false
		expect(result.added).toBe(3);
		expect(result.limitReached).toBeUndefined();
		// 既配信 skip は added を増やさないため、5 source 全件に distribute を試行
		expect(mockDistributeToChildren).toHaveBeenCalledTimes(5);
		const finalCount = 0 + result.added;
		expect(finalCount).toBeLessThanOrEqual(FREE_MAX);
	});

	it('source に配信なし → added 0 (early return)', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		setTargetInitialCount(0);
		mockFindAssignmentsByChild.mockResolvedValue([]);

		const result = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '2' }),
		)) as { copiedFromChild: boolean; added: number };

		expect(result).toEqual({ copiedFromChild: true, added: 0 });
		expect(mockDistributeToChildren).not.toHaveBeenCalled();
	});

	it('CWE-598: tenant 外 child は 403 (tenant guard 維持)', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');

		const result = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '999' }), // 999 は tenant 外
		)) as { status: number };

		expect(result.status).toBe(403);
		expect(mockDistributeToChildren).not.toHaveBeenCalled();
		expect(mockFindAssignmentsByChild).not.toHaveBeenCalled();
	});

	it('source === target → 400', async () => {
		const result = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '1' }),
		)) as { status: number };

		expect(result.status).toBe(400);
		expect(mockDistributeToChildren).not.toHaveBeenCalled();
	});
});

// #3474 item 2: drop 件数を「上限拒否」と「既配信 skip」に分離する failing-test-first。
describe('POST /admin/checklists?/copyDistributionFromChild — drop 件数分離 (#3474 item2)', () => {
	it('limitReached + 既配信混在: 上限拒否は limitRejected のみ計上し既配信を過大帰属しない', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		// target child(2) は 2/3 (残スロット 1)
		setTargetInitialCount(2);
		// source 5 件: 先頭 2 件は target に既配信、残り 3 件は新規
		mockFindAssignmentsByChild.mockResolvedValue([
			{ templateId: 200 }, // 既配信
			{ templateId: 201 }, // 既配信
			{ templateId: 202 }, // 新規 → insert (残スロット消費、3/3 到達)
			{ templateId: 203 }, // 上限で拒否
			{ templateId: 204 }, // 上限で拒否
		]);
		stubDistribute(new Set([200, 201])); // 200/201 は既配信 → insert 0

		const result = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '2' }),
		)) as {
			added: number;
			dropped: number;
			alreadyDistributed: number;
			limitRejected: number;
			limitReached?: boolean;
			message?: string;
		};

		// 新規 insert は 1 件 (202) のみ
		expect(result.added).toBe(1);
		expect(result.alreadyDistributed).toBe(2);
		// 上限で拒否されたのは 203/204 の 2 件のみ (既配信 200/201 を含めない)
		expect(result.limitRejected).toBe(2);
		expect(result.dropped).toBe(4); // 後方互換合計 (2 既配信 + 2 上限拒否)
		expect(result.limitReached).toBe(true);
		// message は「上限に達したため 2 件」であって「4 件」ではない (過大帰属しない)
		expect(result.message).toContain('2 件は取り込めませんでした');
		expect(result.message).not.toContain('4 件は取り込めませんでした');
		expect(result.message).toContain('2 件はすでに配信済み');
	});

	it('上限に達しない場合も alreadyDistributed / limitRejected を返す', async () => {
		mockResolveFullPlanTier.mockResolvedValue('standard');
		mockFindAssignmentsByChild.mockResolvedValue([{ templateId: 200 }, { templateId: 201 }]);
		stubDistribute(new Set([200])); // 200 は既配信、201 は新規

		const result = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '2' }, { licenseStatus: 'active' }),
		)) as { added: number; alreadyDistributed: number; limitRejected: number };

		expect(result.added).toBe(1);
		expect(result.alreadyDistributed).toBe(1);
		expect(result.limitRejected).toBe(0);
	});
});

// #3474 item 1: quota TOCTOU の設計判断 (live 再評価が exact = over-grant なし) の regression。
// SQLite/NUC は同期単一 writer で insert が即反映されるため live 再評価が確定 count を読む。
// 本テストは live count が操作間で共有・持続することを固定し、snapshot staleness による
// over-grant 退行 (ループ前 1 回読みへの巻き戻し) を検出する。設計 SSOT: docs/rationale/14-checklist-copy-toctou-rationale.md
describe('POST /admin/checklists?/copyDistributionFromChild — quota TOCTOU live 再評価 (#3474 item1)', () => {
	it('連続 2 copy でも live count が共有され per-child 上限 (3) を超えない (over-grant なし)', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		setTargetInitialCount(0); // target 0/3
		mockFindAssignmentsByChild.mockResolvedValue([
			{ templateId: 300 },
			{ templateId: 301 },
			{ templateId: 302 },
			{ templateId: 303 },
			{ templateId: 304 },
		]);
		stubDistribute(new Set());

		// 1 回目: 0/3 → 3 件 copy で 3/3 到達、残り 2 件は上限拒否
		const first = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '2' }),
		)) as { added: number; limitReached?: boolean };
		expect(first.added).toBe(3);
		expect(first.limitReached).toBe(true);

		// 2 回目: live count は 3/3 のまま持続 → entry-limit で即 403 (1 件も付与しない)
		const second = (await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '2' }),
		)) as { status?: number };
		expect(second.status).toBe(403);

		// 累計 insert は 3 件 = max。over-grant なし。
		expect(liveTargetCount).toBe(FREE_MAX);
	});
});

// #3474 item 3: 拒否 path の監査 log + NUC actor 解決の failing-test-first。
describe('POST /admin/checklists?/copyDistributionFromChild — 拒否 path 監査 (#3474 item3)', () => {
	it('plan 上限拒否 (403) を actor 付きで warn 監査する', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		setTargetInitialCount(3); // 3/3

		await actions.copyDistributionFromChild!(
			createEvent(
				{ sourceChildId: '1', targetChildId: '2' },
				{ identity: { type: 'cognito', userId: 'user-abc' } },
			),
		);

		const call = mockLoggerWarn.mock.calls.find((c) => String(c[0]).includes('plan 上限で拒否'));
		expect(call, 'plan 上限拒否の監査 warn が呼ばれる').toBeDefined();
		expect(call?.[1]?.context?.denyReason).toBe('plan-limit');
		expect(call?.[1]?.context?.actor).toBe('user-abc');
	});

	it('tenant 外 child 拒否 (CWE-598) を actor 付きで warn 監査する', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');

		await actions.copyDistributionFromChild!(
			createEvent({ sourceChildId: '1', targetChildId: '999' }, { identity: { type: 'local' } }),
		);

		const call = mockLoggerWarn.mock.calls.find((c) => String(c[0]).includes('tenant 外 child'));
		expect(call, 'tenant-violation の監査 warn が呼ばれる').toBeDefined();
		expect(call?.[1]?.context?.denyReason).toBe('tenant-violation');
		// NUC (local) は nuc-local に解決される (旧実装は undefined だった)
		expect(call?.[1]?.context?.actor).toBe('nuc-local');
	});
});
