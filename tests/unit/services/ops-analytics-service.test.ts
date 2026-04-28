// tests/unit/services/ops-analytics-service.test.ts
// OPS 分析サービスのユニットテスト (#822)
// #1602 (ADR-0023 I13): preset distribution テスト追加

import { describe, expect, it } from 'vitest';
import type { Tenant } from '../../../src/lib/server/auth/entities';
import {
	computeAnalytics,
	computePresetDistribution,
	emptyPresetDistribution,
	getMonthKey,
	monthDiff,
	PRESET_DISTRIBUTION_KEYS,
} from '../../../src/lib/server/services/ops-analytics-service';

// --- Helper: Tenant factory ---

function makeTenant(overrides: Partial<Tenant> & { tenantId: string }): Tenant {
	return {
		name: `テナント-${overrides.tenantId}`,
		ownerId: 'owner-1',
		status: 'active',
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		...overrides,
	};
}

// =============================================================
// getMonthKey
// =============================================================

describe('getMonthKey', () => {
	it('Date オブジェクトから YYYY-MM を返す', () => {
		expect(getMonthKey(new Date(2026, 3, 17))).toBe('2026-04');
	});

	it('ISO 文字列から YYYY-MM を返す', () => {
		expect(getMonthKey('2026-01-15T10:00:00Z')).toBe('2026-01');
	});

	it('月が 1 桁の場合ゼロ埋めされる', () => {
		expect(getMonthKey(new Date(2026, 0, 1))).toBe('2026-01');
	});
});

// =============================================================
// monthDiff
// =============================================================

describe('monthDiff', () => {
	it('同月は 0', () => {
		expect(monthDiff('2026-04', '2026-04')).toBe(0);
	});

	it('1 ヶ月差は 1', () => {
		expect(monthDiff('2026-03', '2026-04')).toBe(1);
	});

	it('年をまたぐ差を正しく計算する', () => {
		expect(monthDiff('2025-11', '2026-02')).toBe(3);
	});
});

// =============================================================
// computeAnalytics
// =============================================================

describe('computeAnalytics', () => {
	const now = new Date(2026, 3, 17); // 2026-04-17

	it('テナント 0 件の場合、全値が 0 / 空', () => {
		const result = computeAnalytics([], now);

		expect(result.ltv.estimatedLtv).toBe(0);
		expect(result.ltv.monthlyArpu).toBe(0);
		expect(result.ltv.activeSubscribers).toBe(0);
		expect(result.ltv.churned).toBe(0);
		expect(result.ltv.churnRate).toBe(0);
		expect(result.planBreakdown).toEqual([]);
		expect(result.monthlyAcquisitions).toHaveLength(12);
		expect(result.cohorts).toEqual([]);
	});

	it('MRR に family-monthly と family-yearly が含まれる', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'active',
				plan: 'family-monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't3',
				status: 'active',
				plan: 'family-yearly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		// monthly: 500, family-monthly: 780, family-yearly: round(7800/12) = 650
		const expectedTotalMrr = 500 + 780 + Math.round(7800 / 12);
		const totalMrr = result.planBreakdown.reduce((sum, pb) => sum + pb.mrr, 0);
		expect(totalMrr).toBe(expectedTotalMrr);
	});

	it('planBreakdown に全プラン種別が含まれる', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'active',
				plan: 'yearly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't3',
				status: 'active',
				plan: 'family-monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't4',
				status: 'active',
				plan: 'family-yearly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't5',
				status: 'active',
				plan: 'lifetime',
				createdAt: '2026-04-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		const plans = result.planBreakdown.map((pb) => pb.plan).sort();
		expect(plans).toContain('monthly');
		expect(plans).toContain('yearly');
		expect(plans).toContain('family-monthly');
		expect(plans).toContain('family-yearly');
		expect(plans).toContain('lifetime');
	});

	it('suspended / terminated テナントは MRR に含まれない', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'suspended',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't3',
				status: 'terminated',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		const totalMrr = result.planBreakdown.reduce((sum, pb) => sum + pb.mrr, 0);
		expect(totalMrr).toBe(500); // Only 1 active tenant
	});

	it('LTV = ARPU x avgLifetimeMonths', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		// No churn → avgLifetimeMonths = 60 (上限)
		expect(result.ltv.avgLifetimeMonths).toBe(60);
		expect(result.ltv.monthlyArpu).toBe(500);
		expect(result.ltv.estimatedLtv).toBe(500 * 60);
	});

	it('churnRate が正しく計算される', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'terminated',
				plan: 'monthly',
				createdAt: '2026-01-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		// churnRate = 1 churned / 2 total = 50%
		expect(result.ltv.churnRate).toBe(50);
		expect(result.ltv.churned).toBe(1);
	});

	it('monthlyAcquisitions は過去 12 ヶ月分を返す', () => {
		const result = computeAnalytics([], now);

		expect(result.monthlyAcquisitions).toHaveLength(12);
		// 最初の月は 12 ヶ月前
		expect(result.monthlyAcquisitions[0]?.month).toBe('2025-05');
		// 最後の月は現在月
		expect(result.monthlyAcquisitions[11]?.month).toBe('2026-04');
	});

	it('monthlyAcquisitions に createdAt ベースの集計が反映される', () => {
		const tenants = [
			makeTenant({ tenantId: 't1', status: 'active', createdAt: '2026-04-05T00:00:00Z' }),
			makeTenant({ tenantId: 't2', status: 'active', createdAt: '2026-04-10T00:00:00Z' }),
			makeTenant({ tenantId: 't3', status: 'active', createdAt: '2026-03-01T00:00:00Z' }),
		];

		const result = computeAnalytics(tenants, now);

		const april = result.monthlyAcquisitions.find((ma) => ma.month === '2026-04');
		expect(april?.total).toBe(2);

		const march = result.monthlyAcquisitions.find((ma) => ma.month === '2026-03');
		expect(march?.total).toBe(1);
	});
});

// =============================================================
// #1602 (ADR-0023 I13): computePresetDistribution
// =============================================================

describe('computePresetDistribution', () => {
	it('入力 0 件の場合、全 bucket count = 0 / totalTenants = 0', () => {
		const result = computePresetDistribution([]);

		expect(result.totalTenants).toBe(0);
		expect(result.answeredTenants).toBe(0);
		expect(result.unansweredTenants).toBe(0);
		expect(result.rows).toHaveLength(5);
		for (const row of result.rows) {
			expect(row.count).toBe(0);
			expect(row.percentage).toBe(0);
		}
	});

	it('emptyPresetDistribution と同じ形のオブジェクトを返す', () => {
		const empty = emptyPresetDistribution();
		expect(empty.totalTenants).toBe(0);
		expect(empty.rows.map((r) => r.key)).toEqual([
			'homework-daily',
			'chores',
			'beyond-games',
			'other',
			'none',
		]);
	});

	it('3 軸プリセット (homework-daily / chores / beyond-games) を正しく集計する', () => {
		const result = computePresetDistribution([
			'homework-daily',
			'chores',
			'beyond-games',
			'homework-daily,chores',
		]);

		expect(result.totalTenants).toBe(4);
		expect(result.answeredTenants).toBe(4);
		expect(result.unansweredTenants).toBe(0);

		const findRow = (key: string) => result.rows.find((r) => r.key === key);
		expect(findRow('homework-daily')?.count).toBe(2);
		expect(findRow('chores')?.count).toBe(2);
		expect(findRow('beyond-games')?.count).toBe(1);
		expect(findRow('other')?.count).toBe(0);
		expect(findRow('none')?.count).toBe(0);
	});

	it('複数選択でマルチカウントされる（同一テナントが 2 軸選んだ場合 +2）', () => {
		// 1 テナントで homework-daily + chores 両方選択
		const result = computePresetDistribution(['homework-daily,chores']);

		expect(result.answeredTenants).toBe(1);
		const findRow = (key: string) => result.rows.find((r) => r.key === key);
		expect(findRow('homework-daily')?.count).toBe(1);
		expect(findRow('chores')?.count).toBe(1);
		// 割合は回答テナント数ベースなので 100%
		expect(findRow('homework-daily')?.percentage).toBe(100);
		expect(findRow('chores')?.percentage).toBe(100);
	});

	it('空文字 / undefined は none バケットに集計され、unansweredTenants が増える', () => {
		const result = computePresetDistribution([
			'homework-daily',
			'',
			undefined,
			'   ', // 空白のみ
		]);

		expect(result.totalTenants).toBe(4);
		expect(result.answeredTenants).toBe(1);
		expect(result.unansweredTenants).toBe(3);

		const findRow = (key: string) => result.rows.find((r) => r.key === key);
		expect(findRow('none')?.count).toBe(3);
		// none の percentage は全テナント数ベース → 75%
		expect(findRow('none')?.percentage).toBe(75);
	});

	it('旧キー（morning / homework / balanced 等）は other バケットに集約される', () => {
		// #1592 で廃止された旧 key (morning / homework / exercise / picky / balanced)
		const result = computePresetDistribution([
			'morning',
			'homework',
			'balanced',
			'unknown-future-key',
		]);

		expect(result.answeredTenants).toBe(4);

		const findRow = (key: string) => result.rows.find((r) => r.key === key);
		// morning + homework + balanced + unknown = 4
		expect(findRow('other')?.count).toBe(4);
		// 新 3 軸はすべて 0
		for (const k of PRESET_DISTRIBUTION_KEYS) {
			expect(findRow(k)?.count).toBe(0);
		}
	});

	it('割合は回答テナント数ベース（複数選択により 100% を超え得る）', () => {
		// 2 テナントとも 3 軸全てを選択 → 各軸 2/2 = 100%
		const result = computePresetDistribution([
			'homework-daily,chores,beyond-games',
			'homework-daily,chores,beyond-games',
		]);

		expect(result.answeredTenants).toBe(2);
		const findRow = (key: string) => result.rows.find((r) => r.key === key);
		expect(findRow('homework-daily')?.percentage).toBe(100);
		expect(findRow('chores')?.percentage).toBe(100);
		expect(findRow('beyond-games')?.percentage).toBe(100);
		// 合計 300% を超えるが、これはマルチカウントによる仕様
		const totalPct =
			(findRow('homework-daily')?.percentage ?? 0) +
			(findRow('chores')?.percentage ?? 0) +
			(findRow('beyond-games')?.percentage ?? 0);
		expect(totalPct).toBe(300);
	});

	it('rows の順序は homework-daily → chores → beyond-games → other → none で固定', () => {
		const result = computePresetDistribution(['homework-daily', '']);

		expect(result.rows.map((r) => r.key)).toEqual([
			'homework-daily',
			'chores',
			'beyond-games',
			'other',
			'none',
		]);
	});

	it('混在ケース（旧キー + 新キー + 未回答）の集計', () => {
		const result = computePresetDistribution([
			'homework-daily', // 新
			'chores,beyond-games', // 新（複数）
			'morning,balanced', // 旧（複数）→ other +2
			'', // 未回答
			'beyond-games,unknown', // 新 + unknown → beyond-games +1, other +1
		]);

		expect(result.totalTenants).toBe(5);
		expect(result.answeredTenants).toBe(4);
		expect(result.unansweredTenants).toBe(1);

		const findRow = (key: string) => result.rows.find((r) => r.key === key);
		expect(findRow('homework-daily')?.count).toBe(1);
		expect(findRow('chores')?.count).toBe(1);
		expect(findRow('beyond-games')?.count).toBe(2);
		expect(findRow('other')?.count).toBe(3); // morning + balanced + unknown
		expect(findRow('none')?.count).toBe(1);

		// 割合確認 (回答 = 4 ベース)
		expect(findRow('homework-daily')?.percentage).toBe(25);
		expect(findRow('beyond-games')?.percentage).toBe(50);
		// none のみ全テナント基準 (5)
		expect(findRow('none')?.percentage).toBe(20);
	});
});
