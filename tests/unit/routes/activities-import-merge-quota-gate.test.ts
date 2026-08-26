// tests/unit/routes/activities-import-merge-quota-gate.test.ts
// #3759: #3740 (#3753) の gate 完全性残余 — api/v1/activities/import mode=merge の
// checkActivityLimit gate 欠落を塞ぐ回帰 lock。
//
// 背景 (QM Tier2 レビュー V-2 横展開):
//   #3753 は api/v1 POST / copyFromChild に checkActivityLimit gate を追加したが、
//   api/v1/activities/import mode=merge (dispatchImport 経由) は gate 未通過で実行され、
//   admin importPack (#2894 で gate 済) と非対称だった。free tenant が上限到達後も import で
//   活動を増やせる (取込活動は seed source で quota 集計対象外だが、上限自体の enforce が漏れる)。
//
// 修正 (failing-test-first、ADR-0061): mode=merge の dispatchImport 前に
// checkActivityLimit gate を追加し、5 producer 全経路で gate 対称化。
// 設計判断: admin importPack (#2894) と同型 (source は import strategy が seed を付与するため
// 上書きしない。本 endpoint は client 供給 source 欄を持たないため #3753 POST の source 強制は N/A)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckActivityLimit = vi.fn();
const mockDispatchImport = vi.fn();
const mockRegistryGet = vi.fn();

vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return { ...actual, checkActivityLimit: mockCheckActivityLimit };
});

vi.mock('$lib/marketplace', () => ({
	dispatchImport: (...args: unknown[]) => mockDispatchImport(...args),
	marketplaceRegistry: { get: (...args: unknown[]) => mockRegistryGet(...args) },
}));

// #4692: 取込先 child を明示注入するため handler が getAllChildren を呼ぶ
// (旧: service 内で「tenant 最初の child」に silent bind していた)。
const mockGetAllChildren = vi.fn();
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

const { POST } = await import('../../../src/routes/api/v1/activities/import/+server');

function makeEvent(mode: string, activities: unknown[]) {
	return {
		url: new URL(`https://x/api/v1/activities/import?mode=${mode}`),
		request: new Request('https://x/api/v1/activities/import', {
			method: 'POST',
			body: JSON.stringify({ activities }),
		}),
		// develop の #3334 で本 endpoint に requireRole(['owner','parent']) が入ったため、
		// gate 検証には認証済 parent context (role 付き) を与える。
		locals: { context: { tenantId: 't1', licenseStatus: 'none', role: 'parent' } },
		// biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stub for handler unit test
	} as any;
}

const validActivity = { name: '宿題をする', categoryCode: 'benkyou' };

beforeEach(() => {
	vi.clearAllMocks();
	// strategy.parse は rawPayload をそのまま返す stub
	mockRegistryGet.mockReturnValue({
		strategy: {
			parse: (raw: unknown) => raw,
			preview: vi.fn(),
		},
	});
	mockDispatchImport.mockResolvedValue({ imported: 1, skipped: 0, errors: [] });
	mockGetAllChildren.mockResolvedValue([{ id: '1' }, { id: '2' }]);
});

describe('#3759 api/v1/activities/import mode=merge — checkActivityLimit gate', () => {
	it('上限到達 (allowed=false) では 403 PLAN_LIMIT_EXCEEDED を返し dispatchImport を呼ばない', async () => {
		mockCheckActivityLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });
		const res = await POST(makeEvent('merge', [validActivity]));
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
		expect(mockDispatchImport).not.toHaveBeenCalled();
	});

	it('上限未達 (allowed=true) では従来通り dispatchImport を実行し 200 を返す', async () => {
		mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 1, max: 3 });
		const res = await POST(makeEvent('merge', [validActivity]));
		expect(res.status).toBe(200);
		expect(mockDispatchImport).toHaveBeenCalledTimes(1);
		const body = await res.json();
		expect(body.imported).toBe(1);
	});

	it('無制限プラン (max=null) では gate を通過し dispatchImport を実行する', async () => {
		mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 0, max: null });
		const res = await POST(makeEvent('merge', [validActivity]));
		expect(res.status).toBe(200);
		expect(mockDispatchImport).toHaveBeenCalledTimes(1);
	});

	// #4692: 取込先 child を明示注入する (service 側 first-child silent fallback 撤去の対)。
	it('mode=merge は家族全員を childIds として dispatchImport に渡す', async () => {
		mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 0, max: null });
		await POST(makeEvent('merge', [validActivity]));
		expect(mockDispatchImport).toHaveBeenCalledWith(
			expect.objectContaining({ ctx: expect.objectContaining({ childIds: ['1', '2'] }) }),
		);
	});

	it('子供が 1 人もいない tenant では 400 を返し dispatchImport を呼ばない', async () => {
		mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 0, max: null });
		mockGetAllChildren.mockResolvedValue([]);
		const res = await POST(makeEvent('merge', [validActivity]));
		expect(res.status).toBe(400);
		expect(mockDispatchImport).not.toHaveBeenCalled();
	});

	it('mode=preview は quota gate 対象外 (件数見積のみ、活動を作らない)', async () => {
		const previewFn = vi.fn().mockResolvedValue({
			total: 1,
			newItems: 1,
			duplicates: 0,
			duplicateNames: [],
			byCategory: {},
		});
		mockRegistryGet.mockReturnValue({
			strategy: { parse: (raw: unknown) => raw, preview: previewFn },
		});
		const res = await POST(makeEvent('preview', [validActivity]));
		expect(res.status).toBe(200);
		expect(mockCheckActivityLimit).not.toHaveBeenCalled();
		expect(mockDispatchImport).not.toHaveBeenCalled();
	});
});
