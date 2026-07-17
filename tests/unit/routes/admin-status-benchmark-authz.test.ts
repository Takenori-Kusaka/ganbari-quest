// tests/unit/routes/admin-status-benchmark-authz.test.ts
// #3824 (CWE-639 隣接 / #3593 ④ の実厳格化): market_benchmarks (グローバル master =
// 全テナント共有の age/category 統計基準値) への書込を ops/admin 相当に限定する回帰テスト。
//
// テスト観点 (3 象限 + fail-closed):
// - guard 単体 (requireGlobalMasterWriteAccess): local / ops 許可、parent-admin / anonymous / 未認証 拒否 (403)
// - 書込 (updateBenchmark action): parent-admin 拒否 (403 + upsertBenchmark 未到達) / ops 許可 / local 許可
// - 読取 (load): parent-admin / ops いずれも benchmarks を取得できる (書込 gate は読取に波及しない、#3824 読取現状維持)
//
// failing-test-first (ADR-0061): 実装前は updateBenchmark が parent-admin でも upsertBenchmark に
// 到達する (脆弱性) ため、下記 "parent-admin は 403" が red。guard を action に配線して green。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../../src/lib/server/auth/types';

// ---------- mocks ----------

const mockUpsertBenchmark = vi.fn();
const mockFindAllBenchmarks = vi.fn();
vi.mock('$lib/server/db/status-repo', () => ({
	upsertBenchmark: (...args: unknown[]) => mockUpsertBenchmark(...args),
	findAllBenchmarks: (...args: unknown[]) => mockFindAllBenchmarks(...args),
}));

const mockGetAllChildren = vi.fn();
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

const mockGetLevelTitleList = vi.fn();
vi.mock('$lib/server/services/status-service', () => ({
	getBenchmarkValues: vi.fn(),
	getChildStatus: vi.fn(),
	getLevelTitleList: (...args: unknown[]) => mockGetLevelTitleList(...args),
	getMonthlyComparison: vi.fn(),
	resetAllLevelTitles: vi.fn(),
	resetLevelTitle: vi.fn(),
	saveLevelTitle: vi.fn(),
}));

const { requireGlobalMasterWriteAccess } = await import('../../../src/lib/server/auth/ops-authz');
const { actions, load } = await import('../../../src/routes/(parent)/admin/status/+page.server');

// ---------- helpers ----------

const PARENT_ADMIN: Identity = {
	type: 'cognito',
	userId: 'u-parent',
	email: 'parent@example.com',
	groups: [],
};
const OPS_MEMBER: Identity = {
	type: 'cognito',
	userId: 'u-ops',
	email: 'ops@example.com',
	groups: ['ops'],
};
const LOCAL: Identity = { type: 'local' };
const ANONYMOUS: Identity = { type: 'anonymous', userId: 'anon-1', email: 'anon@example.com' };

function makeLocals(identity: Identity | null): App.Locals {
	return {
		requestId: 'req-test',
		authenticated: identity !== null,
		identity,
		context: { tenantId: 't-test', role: 'owner', licenseStatus: 'active' },
		isDemo: false,
		runtimeMode: 'nuc-prod',
	} as unknown as App.Locals;
}

function makeBenchmarkForm(): Request {
	const fd = new FormData();
	fd.set('age', '4');
	fd.set('categoryId', '1'); // undou (legacyNumericId=1)
	fd.set('mean', '10');
	fd.set('stdDev', '3');
	return new Request('http://localhost/admin/status?/updateBenchmark', {
		method: 'POST',
		body: fd,
	});
}

function makeActionEvent(identity: Identity | null) {
	return {
		request: makeBenchmarkForm(),
		locals: makeLocals(identity),
	} as unknown as Parameters<(typeof actions)['updateBenchmark']>[0];
}

function makeLoadEvent(identity: Identity | null) {
	return {
		locals: makeLocals(identity),
		url: new URL('http://localhost/admin/status'),
	} as unknown as Parameters<typeof load>[0];
}

// ---------- tests ----------

describe('requireGlobalMasterWriteAccess guard (#3824)', () => {
	it('local identity (NUC セルフホスト) は許可 (throw しない)', () => {
		expect(() => requireGlobalMasterWriteAccess(makeLocals(LOCAL))).not.toThrow();
	});

	it('cognito ops group member は許可 (throw しない)', () => {
		expect(() => requireGlobalMasterWriteAccess(makeLocals(OPS_MEMBER))).not.toThrow();
	});

	it('cognito parent-admin (非 ops) は 403 で拒否', () => {
		expect(() => requireGlobalMasterWriteAccess(makeLocals(PARENT_ADMIN))).toThrowError(
			expect.objectContaining({ status: 403 }),
		);
	});

	it('anonymous (demo) は 403 で拒否', () => {
		expect(() => requireGlobalMasterWriteAccess(makeLocals(ANONYMOUS))).toThrowError(
			expect.objectContaining({ status: 403 }),
		);
	});

	it('未認証 (identity=null) は 403 で拒否 (fail-closed)', () => {
		expect(() => requireGlobalMasterWriteAccess(makeLocals(null))).toThrowError(
			expect.objectContaining({ status: 403 }),
		);
	});
});

describe('updateBenchmark action の ops 限定 authz (#3824 書込)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpsertBenchmark.mockResolvedValue({});
	});

	it('parent-admin は 403 で拒否され upsertBenchmark に到達しない (red → green)', async () => {
		await expect(actions.updateBenchmark(makeActionEvent(PARENT_ADMIN))).rejects.toMatchObject({
			status: 403,
		});
		expect(mockUpsertBenchmark).not.toHaveBeenCalled();
	});

	it('anonymous (demo) は 403 で拒否され upsertBenchmark に到達しない', async () => {
		await expect(actions.updateBenchmark(makeActionEvent(ANONYMOUS))).rejects.toMatchObject({
			status: 403,
		});
		expect(mockUpsertBenchmark).not.toHaveBeenCalled();
	});

	it('cognito ops member は成功経路に入り upsertBenchmark を呼ぶ (positive)', async () => {
		const res = await actions.updateBenchmark(makeActionEvent(OPS_MEMBER));
		expect(res).toMatchObject({ success: true, benchmarkUpdated: true });
		expect(mockUpsertBenchmark).toHaveBeenCalledTimes(1);
		// upsertBenchmark(age, categoryId, mean, stdDev, source, tenantId)
		expect(mockUpsertBenchmark).toHaveBeenCalledWith(4, '1', 10, 3, '管理画面', 't-test');
	});

	it('local (NUC セルフホスト) は成功経路に入り upsertBenchmark を呼ぶ (positive)', async () => {
		const res = await actions.updateBenchmark(makeActionEvent(LOCAL));
		expect(res).toMatchObject({ success: true, benchmarkUpdated: true });
		expect(mockUpsertBenchmark).toHaveBeenCalledTimes(1);
	});
});

describe('benchmark 読取 (load) は書込 gate に波及しない (#3824 読取現状維持)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAllChildren.mockResolvedValue([]); // 0 children → per-child service 呼び出しを回避
		mockGetLevelTitleList.mockResolvedValue([]);
		mockFindAllBenchmarks.mockResolvedValue([
			{ age: 4, categoryId: '1', mean: 10, stdDev: 3, source: 'seed' },
		]);
	});

	it('parent-admin は benchmarks を取得できる (読取許可)', async () => {
		const data = (await load(makeLoadEvent(PARENT_ADMIN))) as { benchmarks: unknown[] };
		expect(data.benchmarks).toHaveLength(1);
		expect(mockFindAllBenchmarks).toHaveBeenCalledWith('t-test');
	});

	it('cognito ops member も benchmarks を取得できる (読取許可)', async () => {
		const data = (await load(makeLoadEvent(OPS_MEMBER))) as { benchmarks: unknown[] };
		expect(data.benchmarks).toHaveLength(1);
	});
});

// #3824 (QM Tier2 H1): benchmark 編集 UI ゲートフラグ。書込 authz と同一境界で load が
// canEditBenchmark を返し、+page.svelte が {#if data.canEditBenchmark} で編集フォームを出し分ける。
// parent-admin に false を返すことで「見えるが必ず 403 で失敗する dead-form」を UI 層でも封じる
// (server enforce = updateBenchmark action 403 と併せた防御多層)。読取 (benchmarks) は現状維持で全 admin 可。
describe('canEditBenchmark UI ゲートフラグ (#3824 H1, load 出力)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAllChildren.mockResolvedValue([]);
		mockGetLevelTitleList.mockResolvedValue([]);
		mockFindAllBenchmarks.mockResolvedValue([]);
	});

	it('parent-admin (非 ops) は canEditBenchmark=false (編集 UI 非表示)', async () => {
		const data = (await load(makeLoadEvent(PARENT_ADMIN))) as { canEditBenchmark: boolean };
		expect(data.canEditBenchmark).toBe(false);
	});

	it('cognito ops member は canEditBenchmark=true (編集 UI 表示)', async () => {
		const data = (await load(makeLoadEvent(OPS_MEMBER))) as { canEditBenchmark: boolean };
		expect(data.canEditBenchmark).toBe(true);
	});

	it('local identity (NUC セルフホスト) は canEditBenchmark=true (編集 UI 表示)', async () => {
		const data = (await load(makeLoadEvent(LOCAL))) as { canEditBenchmark: boolean };
		expect(data.canEditBenchmark).toBe(true);
	});

	it('anonymous (demo) は canEditBenchmark=false (編集 UI 非表示)', async () => {
		const data = (await load(makeLoadEvent(ANONYMOUS))) as { canEditBenchmark: boolean };
		expect(data.canEditBenchmark).toBe(false);
	});

	it('未認証 (identity=null) は canEditBenchmark=false (fail-closed)', async () => {
		const data = (await load(makeLoadEvent(null))) as { canEditBenchmark: boolean };
		expect(data.canEditBenchmark).toBe(false);
	});
});
