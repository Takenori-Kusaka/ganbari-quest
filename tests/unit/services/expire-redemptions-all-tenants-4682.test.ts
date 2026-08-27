// tests/unit/services/expire-redemptions-all-tenants-4682.test.ts
// #4682 F3: 30 日超の未処理ごほうび交換申請を expired に移す cron の service を固定する。
//
// なぜ必要か:
//   旧実装は endpoint が `expireOldRedemptions('default')` を直に呼んでおり、`default` 以外の
//   テナントを 1 件も処理しなかった (加えて registry 未登録でどの runtime でも走っていなかった)。
//   全テナントを回す実装に変えたが、**その回し方を間違えると同じ class を再生産する**:
//   `tenants.slice(0, limit)` にすると上限超過分は永久に順番が回らないのに、
//   log には「次回に持ち越し」と書かれて嘘になる (= #4682 が根治しようとしている形そのもの)。
//   そこで「日次ローテーションで全テナントを重複なく周回する」ことを test で固定する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listAllTenants, expireOldRedemptions, countRedemptionRequestsByTenant } = vi.hoisted(
	() => ({
		listAllTenants: vi.fn(),
		expireOldRedemptions: vi.fn(),
		countRedemptionRequestsByTenant: vi.fn(),
	}),
);

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ auth: { listAllTenants } }),
}));
vi.mock('$lib/server/db/reward-redemption-repo', () => ({
	expireOldRedemptions,
	countRedemptionRequestsByTenant,
	// 本 test が触らない facade export も module 解決のために形だけ用意する
	insertRedemptionRequest: vi.fn(),
	insertRedemptionForRestore: vi.fn(),
	findRedemptionRequestsByChild: vi.fn(),
	findRedemptionRequestById: vi.fn(),
	findRedemptionRequestsByTenant: vi.fn(),
	updateRedemptionRequestStatus: vi.fn(),
	hasPendingByReward: vi.fn(),
}));

import {
	EXPIRE_REDEMPTIONS_TENANT_LIMIT,
	expireOldRedemptionsForAllTenants,
} from '../../../src/lib/server/services/reward-redemption-service';

/** tenantId 昇順で N 件のテナントを作る。 */
function tenants(n: number): { tenantId: string }[] {
	return Array.from({ length: n }, (_, i) => ({ tenantId: `t-${String(i).padStart(4, '0')}` }));
}

beforeEach(() => {
	listAllTenants.mockReset();
	expireOldRedemptions.mockReset().mockResolvedValue(1);
	countRedemptionRequestsByTenant.mockReset().mockResolvedValue(3);
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('#4682 F3 全テナントを回す (default 固定をやめる)', () => {
	it('テナントが上限以下なら全件処理し、持ち越しは 0', async () => {
		listAllTenants.mockResolvedValue(tenants(3));

		const r = await expireOldRedemptionsForAllTenants({ today: '2026-08-20' });

		expect(r.tenantsTotal).toBe(3);
		expect(r.tenantsProcessed).toBe(3);
		expect(r.tenantsRemaining).toBe(0);
		expect(r.expiredCount).toBe(3);
		expect(expireOldRedemptions.mock.calls.map((c) => c[0])).toEqual([
			't-0000',
			't-0001',
			't-0002',
		]);
	});

	it('1 テナントの失敗が他テナントを止めない (失敗は数える)', async () => {
		listAllTenants.mockResolvedValue(tenants(3));
		expireOldRedemptions.mockImplementation(async (tenantId: string) => {
			if (tenantId === 't-0001') throw new Error('boom');
			return 2;
		});

		const r = await expireOldRedemptionsForAllTenants({ today: '2026-08-20' });

		expect(r.failures).toBe(1);
		expect(r.tenantsProcessed).toBe(3);
		expect(r.expiredCount).toBe(4);
	});
});

describe('#4682 F3 上限超過分は「永久未処理」にならない (slice(0, limit) の再生産を防ぐ)', () => {
	it('担当スライスは実行日で前進し、ceil(total / limit) 日で全テナントを重複なく網羅する', async () => {
		const all = tenants(5);
		listAllTenants.mockResolvedValue(all);

		const seen: string[][] = [];
		// limit=2 → スライスは 3 つ。連続する 3 日で全テナントが 1 度ずつ処理されるはず。
		for (const today of ['2026-08-20', '2026-08-21', '2026-08-22']) {
			expireOldRedemptions.mockClear();
			await expireOldRedemptionsForAllTenants({ today, tenantLimit: 2 });
			seen.push(expireOldRedemptions.mock.calls.map((c) => c[0] as string));
		}

		const flat = seen.flat().sort();
		expect(flat, '3 日で全テナントを 1 度ずつ処理していない (先頭固定 slice の疑い)').toEqual([
			't-0000',
			't-0001',
			't-0002',
			't-0003',
			't-0004',
		]);
	});

	it('同じ実行日なら同じスライスを選ぶ (失敗日の再実行が同じ担当をやり直す)', async () => {
		listAllTenants.mockResolvedValue(tenants(5));

		expireOldRedemptions.mockClear();
		await expireOldRedemptionsForAllTenants({ today: '2026-08-20', tenantLimit: 2 });
		const first = expireOldRedemptions.mock.calls.map((c) => c[0]);

		expireOldRedemptions.mockClear();
		await expireOldRedemptionsForAllTenants({ today: '2026-08-20', tenantLimit: 2 });
		expect(expireOldRedemptions.mock.calls.map((c) => c[0])).toEqual(first);
	});

	it('今日の担当外は「ローテーション」として数え、予算超過とは区別する', async () => {
		listAllTenants.mockResolvedValue(tenants(5));

		const r = await expireOldRedemptionsForAllTenants({ today: '2026-08-20', tenantLimit: 2 });

		expect(r.tenantsSkippedByRotation).toBe(3);
		expect(r.tenantsSkippedByBudget).toBe(0);
		expect(r.sliceCount).toBe(3);
	});

	it('既定の上限は 200 で、200 以下なら 1 日で全件回る', async () => {
		expect(EXPIRE_REDEMPTIONS_TENANT_LIMIT).toBe(200);
		listAllTenants.mockResolvedValue(tenants(EXPIRE_REDEMPTIONS_TENANT_LIMIT));

		const r = await expireOldRedemptionsForAllTenants({ today: '2026-08-20' });
		expect(r.sliceCount).toBe(1);
		expect(r.tenantsProcessed).toBe(EXPIRE_REDEMPTIONS_TENANT_LIMIT);
	});
});

describe('#4682 F3 self-limiting (13-AWS設計書 §3.3)', () => {
	it('時間予算を使い切ったら担当スライスの途中で打ち切り、打ち切り数を報告する', async () => {
		listAllTenants.mockResolvedValue(tenants(3));
		let calls = 0;
		const budget = {
			// 1 件処理したところで予算切れにする
			exceeded: () => calls++ >= 1,
			elapsedMs: () => 0,
		};

		const r = await expireOldRedemptionsForAllTenants({ today: '2026-08-20', budget });

		expect(r.budgetExceeded).toBe(true);
		expect(r.tenantsProcessed).toBe(1);
		expect(r.tenantsSkippedByBudget).toBe(2);
		expect(r.tenantsRemaining).toBe(2);
	});
});

describe('#4682 F3 dry-run (本番投入前に影響件数を観測する)', () => {
	it('dryRun では status を書き換えず、対象件数だけ数える', async () => {
		listAllTenants.mockResolvedValue(tenants(2));

		const r = await expireOldRedemptionsForAllTenants({ today: '2026-08-20', dryRun: true });

		expect(expireOldRedemptions, 'dryRun なのに更新している').not.toHaveBeenCalled();
		expect(countRedemptionRequestsByTenant).toHaveBeenCalledTimes(2);
		expect(r.dryRun).toBe(true);
		expect(r.expiredCount).toBe(6);
	});

	it('既定は dryRun=false (実際に expired へ移す)', async () => {
		listAllTenants.mockResolvedValue(tenants(1));

		const r = await expireOldRedemptionsForAllTenants({ today: '2026-08-20' });

		expect(r.dryRun).toBe(false);
		expect(expireOldRedemptions).toHaveBeenCalledTimes(1);
	});
});
