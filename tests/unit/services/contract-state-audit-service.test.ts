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
const mockCountValuesByPrefix = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { listAllTenants: mockListAllTenants },
		settings: { countValuesByPrefix: mockCountValuesByPrefix },
	}),
}));

import {
	auditContractStates,
	isProblemClassification,
	MAX_PROBLEM_ROWS,
} from '../../../src/lib/server/services/contract-state-audit-service';
import {
	JST_MONTH_KEY_PREFIX,
	LOYALTY_LAST_INCREMENT_MONTH_KEY,
} from '../../../src/lib/server/services/loyalty-service';

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
	// 既定は「保存済み 0 件」。#4269 ① の test は各自で上書きする。
	mockCountValuesByPrefix.mockResolvedValue({ total: 0, withPrefix: 0 });
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

// ─────────────────────────────────────────────────────────────
// #4269 ①: prefix 無しの継続月キー (基準不明値) の滞留在庫
// ─────────────────────────────────────────────────────────────
//
// `loyalty_last_increment_month` が prefix 無しの旧値だと、継続月数の加算は
// **安全側に倒して skip** される (loyalty-service `classifyMonthKeyMatch` の `ambiguous-legacy`)。
// skip 分岐は値を再 write しないため、以後 `invoice.paid` が来ないテナントでは
// 基準不明値が **滞留し続ける**。
//
// PR #4303 の warn ログは「skip が起きた瞬間」しか残さず、滞留を数えない。
// 「回復可能だから skip してよい」と判断した以上、**回復が要ると気づく経路**が要る
// (気づく経路が無いなら、それは回復可能ではない)。専用の機構は作らず、
// 本 service (= /ops の在庫) に件数だけ相乗りさせる。

describe('#4269 ①: prefix 無しの継続月キーの滞留を /ops の在庫で数える', () => {
	it('prefix 無しの値を持つテナントが居るとき、その件数を報告する', async () => {
		mockListAllTenants.mockResolvedValue([tenant({})]);
		mockCountValuesByPrefix.mockResolvedValue({ total: 7, withPrefix: 5 });

		const result = await auditContractStates();

		expect(
			result.loyaltyMonthKeys.legacy,
			'prefix 無しの滞留が /ops のどこにも出ていません (気づく経路が無い = 回復可能ではない)',
		).toBe(2);
		expect(result.loyaltyMonthKeys.total, '母数が無いと「2 件」の重さが分かりません').toBe(7);
	});

	it('0 件でも 0 件と出す (行が消えると「見ていない」と区別がつかない)', async () => {
		mockListAllTenants.mockResolvedValue([]);
		mockCountValuesByPrefix.mockResolvedValue({ total: 0, withPrefix: 0 });

		const result = await auditContractStates();

		expect(result.loyaltyMonthKeys, '0 件のとき key ごと消えています').toBeDefined();
		expect(result.loyaltyMonthKeys.legacy).toBe(0);
		expect(result.loyaltyMonthKeys.total).toBe(0);
	});

	it('数えるのは 1 クエリ (テナントごとに引かない = N+1 禁止、ADR-0065 原則 2)', async () => {
		mockListAllTenants.mockResolvedValue([
			tenant({ tenantId: 't-1' }),
			tenant({ tenantId: 't-2' }),
			tenant({ tenantId: 't-3' }),
		]);
		mockCountValuesByPrefix.mockResolvedValue({ total: 3, withPrefix: 3 });

		await auditContractStates();

		expect(mockCountValuesByPrefix, 'テナント数に比例して引いています').toHaveBeenCalledTimes(1);
	});

	it('判定は loyalty-service と同じ key / prefix を使う (判定を 2 つに分けない)', async () => {
		mockListAllTenants.mockResolvedValue([]);

		await auditContractStates();

		expect(mockCountValuesByPrefix).toHaveBeenCalledWith(
			LOYALTY_LAST_INCREMENT_MONTH_KEY,
			JST_MONTH_KEY_PREFIX,
		);
	});

	it('件数だけを出す (どのテナントかは持ち出さない)', async () => {
		mockListAllTenants.mockResolvedValue([]);
		mockCountValuesByPrefix.mockResolvedValue({ total: 4, withPrefix: 1 });

		const result = await auditContractStates();

		expect(Object.keys(result.loyaltyMonthKeys).sort()).toEqual(['legacy', 'total']);
	});
});
