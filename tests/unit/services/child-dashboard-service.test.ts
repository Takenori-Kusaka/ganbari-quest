/**
 * ChildDashboardService — POC + write API test suite (Issue #2069 + #2085 / ADR-0046)
 *
 * カバー範囲:
 *   - ProductionDashboardService:
 *     * コンストラクタで受け取った getter 関数で最新値取得
 *     * recordActivity / cancelRecord / claimLoginBonus / toggleActivityPin
 *       が REST `/api/v1/...` を fetch で正しく叩く
 *     * REST 200/201/4xx/network failure それぞれで discriminated union 戻り値が正しい
 *     * childId 未選択時は NOT_FOUND を返す
 *   - DemoDashboardService:
 *     * SSR (sessionStorage 不在) で seed を返す / CSR で restore する /
 *       壊れた JSON で seed fallback する
 *     * recordActivity で todayRecorded が in-memory + sessionStorage に増分される
 *     * cancelRecord は最後の record を decrement する
 *     * claimLoginBonus は 1 回目 ok / 2 回目 ALREADY_CLAIMED
 *     * toggleActivityPin は in-memory state を切替える
 *   - persistDemoHomeData / clearDemoHomeData: storage 不在環境で例外を投げない
 *   - getter 経由なので seed 元 (例: layout の data) が変化したら自動追従
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import type { Child } from '$lib/server/db/types/index.js';
import {
	clearDemoHomeData,
	createDemoDashboardService,
	DemoDashboardService,
	persistDemoHomeData,
} from '$lib/services/demo/DashboardService';
import {
	createProductionDashboardService,
	ProductionDashboardService,
} from '$lib/services/production/DashboardService';
import type { ChildDashboardHomeData } from '$lib/services/types';

const SAMPLE_SEED: ChildDashboardHomeData = {
	child: null,
	todayRecorded: [{ activityId: 1, count: 2 }],
	pointSettings: DEFAULT_POINT_SETTINGS,
};

describe('ProductionDashboardService', () => {
	it('kind は "production"', () => {
		const svc = createProductionDashboardService(() => SAMPLE_SEED);
		expect(svc.kind).toBe('production');
	});

	it('getHomeData は getter が返したスナップショットを返す', () => {
		const svc = new ProductionDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('factory 関数は ProductionDashboardService インスタンスを返す', () => {
		const svc = createProductionDashboardService(() => SAMPLE_SEED);
		expect(svc).toBeInstanceOf(ProductionDashboardService);
	});

	it('getter が変化した値を返したら getHomeData も追従する', () => {
		let current: ChildDashboardHomeData = SAMPLE_SEED;
		const svc = createProductionDashboardService(() => current);
		expect(svc.getHomeData().todayRecorded).toEqual(SAMPLE_SEED.todayRecorded);
		current = {
			child: null,
			todayRecorded: [{ activityId: 99, count: 3 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
		expect(svc.getHomeData().todayRecorded).toEqual([{ activityId: 99, count: 3 }]);
	});
});

describe('DemoDashboardService', () => {
	const DEMO_KEY = 'gq:demo:child-dashboard-home-v1';

	beforeEach(() => {
		// 各テストの前に sessionStorage をクリア（jsdom 環境）
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.clear();
		}
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('kind は "demo"', () => {
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.kind).toBe('demo');
	});

	it('factory 関数は DemoDashboardService インスタンスを返す', () => {
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc).toBeInstanceOf(DemoDashboardService);
	});

	it('CSR (sessionStorage 有 + 中身なし) で seed を返す', () => {
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('CSR で sessionStorage に valid なデータがあればそれを返す', () => {
		const stored: ChildDashboardHomeData = {
			child: null,
			todayRecorded: [{ activityId: 9, count: 5 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
		sessionStorage.setItem(DEMO_KEY, JSON.stringify(stored));
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData().todayRecorded).toEqual(stored.todayRecorded);
	});

	it('壊れた JSON があったら seed に fallback する', () => {
		sessionStorage.setItem(DEMO_KEY, '{not-valid-json');
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('schema 違反 (todayRecorded が配列でない) なら seed に fallback', () => {
		sessionStorage.setItem(DEMO_KEY, JSON.stringify({ todayRecorded: 'broken' }));
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('SSR (window 不在) では seed をそのまま返す', () => {
		// jsdom 環境では window が定義済みのため、明示的に undefined を stub する
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('sessionStorage', undefined);
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('persistDemoHomeData は SSR (window 不在) で例外を投げない', () => {
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('sessionStorage', undefined);
		expect(() => persistDemoHomeData(SAMPLE_SEED)).not.toThrow();
	});

	it('clearDemoHomeData は SSR (window 不在) で例外を投げない', () => {
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('sessionStorage', undefined);
		expect(() => clearDemoHomeData()).not.toThrow();
	});

	it('persistDemoHomeData → getHomeData の往復で同一データを取得できる', () => {
		const customSeed: ChildDashboardHomeData = {
			child: null,
			todayRecorded: [{ activityId: 42, count: 7 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
		persistDemoHomeData(customSeed);
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData().todayRecorded).toEqual(customSeed.todayRecorded);
	});

	it('clearDemoHomeData 後は seed が返る', () => {
		persistDemoHomeData({
			child: null,
			todayRecorded: [{ activityId: 1, count: 99 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		});
		clearDemoHomeData();
		const svc = createDemoDashboardService(() => SAMPLE_SEED);
		expect(svc.getHomeData()).toEqual(SAMPLE_SEED);
	});

	it('getter 経由なので layout の data 変化に追従する', () => {
		let current: ChildDashboardHomeData = SAMPLE_SEED;
		const svc = createDemoDashboardService(() => current);
		expect(svc.getHomeData().todayRecorded).toEqual(SAMPLE_SEED.todayRecorded);
		current = {
			child: null,
			todayRecorded: [{ activityId: 77, count: 11 }],
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
		expect(svc.getHomeData().todayRecorded).toEqual([{ activityId: 77, count: 11 }]);
	});
});

// ============================================================
// Issue #2085 — write API tests
// ============================================================

const SAMPLE_CHILD: Child = {
	id: 42,
	nickname: 'テスト',
	age: 7,
	birthDate: null,
	theme: 'default',
	uiMode: 'elementary',
	uiModeManuallySet: 0,
	avatarUrl: null,
	displayConfig: null,
	userId: null,
	birthdayBonusMultiplier: 1,
	lastBirthdayBonusYear: null,
	isArchived: 0,
	archivedReason: null,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
};

const SEED_WITH_CHILD: ChildDashboardHomeData = {
	child: SAMPLE_CHILD,
	todayRecorded: [],
	pointSettings: DEFAULT_POINT_SETTINGS,
};

/** vi.fn ベースの fetch mock を組み立てる。1 呼出ごとの応答を順次返す。 */
function makeFetchMock(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
	const fn = vi.fn(async () => {
		const next = responses.shift();
		if (!next) throw new Error('fetch mock: no more responses');
		return {
			ok: next.ok,
			status: next.status,
			json: async () => next.body,
		} as unknown as Response;
	});
	return fn as unknown as typeof fetch;
}

describe('ProductionDashboardService — recordActivity', () => {
	it('childId が解決できれば POST /api/v1/activity-logs を叩き 201 を ok:true に変換する', async () => {
		const fetchMock = vi.fn(async () => {
			return {
				ok: true,
				status: 201,
				json: async () => ({
					id: 12345,
					activityName: 'お皿あらい',
					totalPoints: 18,
					streakDays: 5,
					streakBonus: 3,
					cancelableUntil: '2026-05-14T12:00:00.000Z',
				}),
			} as unknown as Response;
		}) as unknown as typeof fetch;

		const svc = createProductionDashboardService(() => SEED_WITH_CHILD, fetchMock);
		const result = await svc.recordActivity({ activityId: 7 });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.logId).toBe(12345);
			expect(result.activityName).toBe('お皿あらい');
			expect(result.totalPoints).toBe(18);
		}
		const mockCalls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
		const firstCall = mockCalls[0];
		if (!firstCall) throw new Error('fetch mock was not called');
		expect(firstCall[0]).toBe('/api/v1/activity-logs');
		const callOpts = firstCall[1] as { method: string; body: string };
		expect(callOpts.method).toBe('POST');
		expect(JSON.parse(callOpts.body)).toEqual({ childId: 42, activityId: 7 });
	});

	it('child 未選択 (child=null) なら NOT_FOUND を返し fetch を呼ばない', async () => {
		const fetchMock = vi.fn();
		const svc = createProductionDashboardService(
			() => ({ ...SEED_WITH_CHILD, child: null }),
			fetchMock as unknown as typeof fetch,
		);
		const result = await svc.recordActivity({ activityId: 1 });
		expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('ALREADY_RECORDED エラーは ALREADY_RECORDED にマップされる', async () => {
		const fetchMock = makeFetchMock([
			{ ok: false, status: 409, body: { error: 'ALREADY_RECORDED' } },
		]);
		const svc = createProductionDashboardService(() => SEED_WITH_CHILD, fetchMock);
		const result = await svc.recordActivity({ activityId: 7 });
		expect(result).toEqual({ ok: false, error: 'ALREADY_RECORDED' });
	});

	it('fetch が throw した場合は NETWORK エラーになる', async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error('boom');
		}) as unknown as typeof fetch;
		const svc = createProductionDashboardService(() => SEED_WITH_CHILD, fetchMock);
		const result = await svc.recordActivity({ activityId: 7 });
		expect(result).toEqual({ ok: false, error: 'NETWORK' });
	});
});

describe('ProductionDashboardService — cancelRecord', () => {
	it('成功時は refundedPoints を返す', async () => {
		const fetchMock = makeFetchMock([
			{ ok: true, status: 200, body: { refundedPoints: 15, message: 'ok' } },
		]);
		const svc = createProductionDashboardService(() => SEED_WITH_CHILD, fetchMock);
		const result = await svc.cancelRecord({ logId: 999 });
		expect(result).toEqual({ ok: true, refundedPoints: 15 });
		const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
		const firstCall = calls[0];
		if (!firstCall) throw new Error('fetch mock was not called');
		expect(firstCall[0]).toBe('/api/v1/activity-logs/999');
		expect((firstCall[1] as { method: string }).method).toBe('DELETE');
	});

	it('CANCEL_EXPIRED を返す', async () => {
		const fetchMock = makeFetchMock([
			{ ok: false, status: 410, body: { error: 'CANCEL_EXPIRED' } },
		]);
		const svc = createProductionDashboardService(() => SEED_WITH_CHILD, fetchMock);
		const result = await svc.cancelRecord({ logId: 1 });
		expect(result).toEqual({ ok: false, error: 'CANCEL_EXPIRED' });
	});
});

describe('ProductionDashboardService — claimLoginBonus', () => {
	it('成功時は claim 結果を返す', async () => {
		const fetchMock = makeFetchMock([
			{
				ok: true,
				status: 201,
				body: {
					rank: 'daikichi',
					basePoints: 5,
					multiplier: 2,
					totalPoints: 10,
					consecutiveLoginDays: 7,
					message: 'おめでとう',
				},
			},
		]);
		const svc = createProductionDashboardService(() => SEED_WITH_CHILD, fetchMock);
		const result = await svc.claimLoginBonus();
		expect(result).toEqual({
			ok: true,
			rank: 'daikichi',
			basePoints: 5,
			multiplier: 2,
			totalPoints: 10,
			consecutiveLoginDays: 7,
		});
		const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
		const firstCall = calls[0];
		if (!firstCall) throw new Error('fetch mock was not called');
		expect(firstCall[0]).toBe('/api/v1/login-bonus/42/claim');
		expect((firstCall[1] as { method: string }).method).toBe('POST');
	});

	it('child 未選択なら NOT_FOUND を返す', async () => {
		const fetchMock = vi.fn();
		const svc = createProductionDashboardService(
			() => ({ ...SEED_WITH_CHILD, child: null }),
			fetchMock as unknown as typeof fetch,
		);
		const result = await svc.claimLoginBonus();
		expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
	});
});

describe('ProductionDashboardService — toggleActivityPin', () => {
	it('成功時は isPinned を返す', async () => {
		const fetchMock = makeFetchMock([{ ok: true, status: 200, body: { isPinned: true } }]);
		const svc = createProductionDashboardService(() => SEED_WITH_CHILD, fetchMock);
		const result = await svc.toggleActivityPin({ activityId: 5, pinned: true });
		expect(result).toEqual({ ok: true, isPinned: true });
		const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
		const firstCall = calls[0];
		if (!firstCall) throw new Error('fetch mock was not called');
		expect(firstCall[0]).toBe('/api/v1/children/42/activities/5/pin');
	});

	it('上限エラーは LIMIT_EXCEEDED にマップされる', async () => {
		const fetchMock = makeFetchMock([
			{
				ok: false,
				status: 400,
				body: { error: 'VALIDATION_ERROR', message: '1カテゴリあたりのピン留め上限を超えています' },
			},
		]);
		const svc = createProductionDashboardService(() => SEED_WITH_CHILD, fetchMock);
		const result = await svc.toggleActivityPin({ activityId: 5, pinned: true });
		expect(result).toEqual({ ok: false, error: 'LIMIT_EXCEEDED' });
	});
});

describe('DemoDashboardService — recordActivity', () => {
	beforeEach(() => {
		if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('todayRecorded を increment し sessionStorage に persist する', async () => {
		const svc = createDemoDashboardService(() => SEED_WITH_CHILD);
		const result = await svc.recordActivity({ activityId: 10 });
		expect(result.ok).toBe(true);

		// sessionStorage に書き戻されている
		const raw = sessionStorage.getItem('gq:demo:child-dashboard-home-v1');
		expect(raw).not.toBeNull();
		const restored = JSON.parse(raw ?? '{}') as ChildDashboardHomeData;
		expect(restored.todayRecorded).toEqual([{ activityId: 10, count: 1 }]);

		// 同じ activity をもう一度叩くと count が 2 になる
		await svc.recordActivity({ activityId: 10 });
		const raw2 = sessionStorage.getItem('gq:demo:child-dashboard-home-v1');
		const restored2 = JSON.parse(raw2 ?? '{}') as ChildDashboardHomeData;
		expect(restored2.todayRecorded).toEqual([{ activityId: 10, count: 2 }]);
	});

	it('複数の activity を independent に increment する', async () => {
		const svc = createDemoDashboardService(() => SEED_WITH_CHILD);
		await svc.recordActivity({ activityId: 10 });
		await svc.recordActivity({ activityId: 20 });
		await svc.recordActivity({ activityId: 10 });
		const restored = JSON.parse(
			sessionStorage.getItem('gq:demo:child-dashboard-home-v1') ?? '{}',
		) as ChildDashboardHomeData;
		// 順不同の expectation のため content マッチ
		expect(restored.todayRecorded).toEqual(
			expect.arrayContaining([
				{ activityId: 10, count: 2 },
				{ activityId: 20, count: 1 },
			]),
		);
		expect(restored.todayRecorded).toHaveLength(2);
	});

	it('SSR 環境 (window 不在) でも例外を投げず in-memory のみで完了する', async () => {
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('sessionStorage', undefined);
		const svc = createDemoDashboardService(() => SEED_WITH_CHILD);
		const result = await svc.recordActivity({ activityId: 1 });
		expect(result.ok).toBe(true);
	});
});

describe('DemoDashboardService — cancelRecord', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
		if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
	});

	it('record → cancel で count が decrement される', async () => {
		const svc = createDemoDashboardService(() => SEED_WITH_CHILD);
		await svc.recordActivity({ activityId: 10 });
		const cancelled = await svc.cancelRecord({ logId: 0 });
		expect(cancelled.ok).toBe(true);
		const restored = JSON.parse(
			sessionStorage.getItem('gq:demo:child-dashboard-home-v1') ?? '{}',
		) as ChildDashboardHomeData;
		expect(restored.todayRecorded).toEqual([]);
	});

	it('record せずに cancel を呼ぶと NOT_FOUND', async () => {
		const svc = createDemoDashboardService(() => SEED_WITH_CHILD);
		const result = await svc.cancelRecord({ logId: 999 });
		expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
	});
});

describe('DemoDashboardService — claimLoginBonus', () => {
	it('1 回目は ok、2 回目は ALREADY_CLAIMED', async () => {
		const svc = createDemoDashboardService(() => SEED_WITH_CHILD);
		const first = await svc.claimLoginBonus();
		expect(first.ok).toBe(true);
		const second = await svc.claimLoginBonus();
		expect(second).toEqual({ ok: false, error: 'ALREADY_CLAIMED' });
	});
});

describe('DemoDashboardService — toggleActivityPin', () => {
	it('pinned=true / false が in-memory map に反映される', async () => {
		const svc = createDemoDashboardService(() => SEED_WITH_CHILD);
		const r1 = await svc.toggleActivityPin({ activityId: 1, pinned: true });
		expect(r1).toEqual({ ok: true, isPinned: true });
		const r2 = await svc.toggleActivityPin({ activityId: 1, pinned: false });
		expect(r2).toEqual({ ok: true, isPinned: false });
	});
});
