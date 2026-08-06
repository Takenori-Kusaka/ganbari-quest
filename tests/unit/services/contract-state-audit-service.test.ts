// tests/unit/services/contract-state-audit-service.test.ts
// EPIC #4118 手 3 — 本番行の分類監査。
//
// 手 2 (webhook 適用後の行が S1-S6 に収まる) は「これから入る変更」を止めるが、
// **すでに本番に存在する不正行は検出しない**。本 service はその在庫を数える。
//
// 「0 件」が **正常** なのか **監査が動いていない** のかを取り違えないよう、
// 正常件数と母数も返す契約を test で固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListAllTenants = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ auth: { listAllTenants: mockListAllTenants } }),
}));

import {
	auditContractStates,
	isProblemClassification,
	MAX_PROBLEM_ROWS,
} from '../../../src/lib/server/services/contract-state-audit-service';

/** 分類に効く 4 列だけ持つ最小 tenant。 */
function tenant(overrides: Record<string, unknown>) {
	return {
		tenantId: 't-1',
		name: 'テスト家族',
		ownerId: 'u-1',
		status: 'active',
		plan: 'monthly',
		stripeCustomerId: 'cus_1',
		stripeSubscriptionId: 'sub_1',
		planExpiresAt: undefined,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('#4118 手 3: 本番行の契約状態監査', () => {
	it('正常行 (S2) は問題として挙げない', async () => {
		mockListAllTenants.mockResolvedValue([tenant({ tenantId: 't-ok' })]);
		const result = await auditContractStates();

		expect(result.total).toBe(1);
		expect(result.counts.S2).toBe(1);
		expect(result.problemRows).toEqual([]);
	});

	it('X3 (active なのに猶予終了日が残る) を検出する — #4118 手 2 で直した欠陥の在庫', async () => {
		mockListAllTenants.mockResolvedValue([
			tenant({ tenantId: 't-x3', status: 'active', planExpiresAt: '2026-09-01T00:00:00Z' }),
		]);
		const result = await auditContractStates();

		expect(result.counts.X3).toBe(1);
		expect(result.problemRows).toHaveLength(1);
		expect(result.problemRows[0]?.tenantId).toBe('t-x3');
		expect(result.problemRows[0]?.classification).toBe('X3');
	});

	it('問題行に PII を含めない (tenantId と 4 列の有無だけ)', async () => {
		mockListAllTenants.mockResolvedValue([
			tenant({ tenantId: 't-x1', name: '山田家', stripeSubscriptionId: null }),
		]);
		const result = await auditContractStates();

		const row = result.problemRows[0];
		expect(row).toBeDefined();
		expect(
			Object.keys(row ?? {}).sort(),
			'復旧に要らない列 (name / email / stripeCustomerId 等) を持ち出しています',
		).toEqual([
			'classification',
			'hasPlan',
			'hasPlanExpiresAt',
			'hasSubscription',
			'status',
			'tenantId',
		]);
	});

	it('全 classification の key を 0 で持つ (0 件を「key が無い」で表さない)', async () => {
		mockListAllTenants.mockResolvedValue([]);
		const result = await auditContractStates();

		expect(result.total).toBe(0);
		for (const key of [
			'S1',
			'S2',
			'S3',
			'S4',
			'S5',
			'S6',
			'X1',
			'X2',
			'X3',
			'X4',
			'UNCLASSIFIED',
		]) {
			expect(result.counts[key as keyof typeof result.counts], `${key} の key がありません`).toBe(
				0,
			);
		}
	});

	it('counts の合計が母数と一致する (数え漏らしを作らない)', async () => {
		mockListAllTenants.mockResolvedValue([
			tenant({ tenantId: 't-1' }),
			tenant({ tenantId: 't-2', status: 'active', planExpiresAt: '2026-09-01T00:00:00Z' }),
			tenant({ tenantId: 't-3', stripeSubscriptionId: null }),
			tenant({ tenantId: 't-4', status: 'suspended', plan: null, stripeSubscriptionId: null }),
		]);
		const result = await auditContractStates();

		const sum = Object.values(result.counts).reduce((a, b) => a + b, 0);
		expect(sum, 'counts の合計が母数と食い違っています').toBe(result.total);
		expect(result.total).toBe(4);
	});

	it('問題行が多すぎるときは上限で切り、切った件数を残す (黙って捨てない)', async () => {
		const many = Array.from({ length: MAX_PROBLEM_ROWS + 5 }, (_, i) =>
			tenant({ tenantId: `t-${i}`, status: 'active', planExpiresAt: '2026-09-01T00:00:00Z' }),
		);
		mockListAllTenants.mockResolvedValue(many);
		const result = await auditContractStates();

		expect(result.problemRows).toHaveLength(MAX_PROBLEM_ROWS);
		expect(result.truncated, '上限で切った件数が失われています').toBe(5);
		expect(result.counts.X3, '切っても集計は全件数える').toBe(MAX_PROBLEM_ROWS + 5);
	});

	it('S1-S6 は問題扱いしない / X1-X4 と UNCLASSIFIED は問題扱いする', () => {
		for (const s of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const) {
			expect(isProblemClassification(s), `${s} を問題扱いしています`).toBe(false);
		}
		for (const s of ['X1', 'X2', 'X3', 'X4', 'UNCLASSIFIED'] as const) {
			expect(isProblemClassification(s), `${s} を見逃しています`).toBe(true);
		}
	});
});
