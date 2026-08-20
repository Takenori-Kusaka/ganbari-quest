// tests/unit/services/ops-service.test.ts
// 運営管理サービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsPlanRow } from '../../../src/lib/domain/ops-plan-rows';
import type { Tenant } from '../../../src/lib/server/auth/entities';
import type {
	AWSCostData,
	InvoiceRow,
	RevenueData,
} from '../../../src/lib/server/services/ops-service';

// --- Top-level mock fns ---

const mockListAllTenants = vi.fn<() => Promise<Tenant[]>>();
const mockIsStripeEnabled = vi.fn<() => boolean>();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { listAllTenants: mockListAllTenants },
	}),
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => mockIsStripeEnabled(),
	getStripeClient: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// --- Import after mocks ---

import {
	generateExpenseLedgerCsv,
	generatePLSummary,
	generateSalesLedgerCsv,
	getKpiSummary,
	getRevenueData,
} from '../../../src/lib/server/services/ops-service';

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

/**
 * 行配列を plan → 値の表に畳む (#4505)。
 *
 * `toEqual` で表ごと比較することで、**プランが増えて行が生えたときに test が落ちる**
 * (行を 1 つずつ拾う書き方だと、増えたプランを誰も見ないまま緑になる)。
 */
function planTenants(rows: OpsPlanRow[]): Record<string, number> {
	return Object.fromEntries(rows.map((r) => [r.plan, r.tenants]));
}

function planMrr(rows: OpsPlanRow[]): Record<string, number> {
	return Object.fromEntries(rows.map((r) => [r.plan, r.mrr]));
}

// =============================================================
// getKpiSummary
// =============================================================

describe('getKpiSummary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsStripeEnabled.mockReturnValue(false);
	});

	it('テナントが0件の場合、全カウント0・activeRate=0', async () => {
		mockListAllTenants.mockResolvedValue([]);

		const result = await getKpiSummary();

		expect(result.tenantStats.total).toBe(0);
		expect(result.tenantStats.active).toBe(0);
		expect(result.tenantStats.gracePeriod).toBe(0);
		expect(result.tenantStats.suspended).toBe(0);
		expect(result.tenantStats.terminated).toBe(0);
		expect(result.activeRate).toBe(0);
		expect(result.tenantStats.newThisMonth).toBe(0);
		expect(planTenants(result.tenantStats.planRows)).toEqual({
			monthly: 0,
			yearly: 0,
			'family-monthly': 0,
			'family-yearly': 0,
			lifetime: 0,
		});
		expect(result.tenantStats.unclassified).toBe(0);
		expect(result.tenantStats.totalMrr).toBe(0);
	});

	it('複数テナント(異なるステータス)を正しく集計する', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', status: 'active' }),
			makeTenant({ tenantId: 't2', status: 'active' }),
			makeTenant({ tenantId: 't3', status: 'suspended' }),
			makeTenant({ tenantId: 't4', status: 'grace_period' }),
			makeTenant({ tenantId: 't5', status: 'terminated' }),
		]);

		const result = await getKpiSummary();

		expect(result.tenantStats.total).toBe(5);
		expect(result.tenantStats.active).toBe(2);
		expect(result.tenantStats.suspended).toBe(1);
		expect(result.tenantStats.gracePeriod).toBe(1);
		expect(result.tenantStats.terminated).toBe(1);
	});

	it('activeRate = active / total で算出される', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', status: 'active' }),
			makeTenant({ tenantId: 't2', status: 'active' }),
			makeTenant({ tenantId: 't3', status: 'active' }),
			makeTenant({ tenantId: 't4', status: 'suspended' }),
		]);

		const result = await getKpiSummary();

		expect(result.activeRate).toBe(3 / 4);
	});

	it('プラン内訳は active テナントのみ集計する', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' }),
			makeTenant({ tenantId: 't2', status: 'active', plan: 'yearly' }),
			makeTenant({ tenantId: 't3', status: 'active', plan: 'lifetime' }),
			makeTenant({ tenantId: 't4', status: 'active' }), // no plan
			makeTenant({ tenantId: 't5', status: 'suspended', plan: 'monthly' }), // ignored
			makeTenant({ tenantId: 't6', status: 'terminated', plan: 'yearly' }), // ignored
		]);

		const result = await getKpiSummary();

		expect(planTenants(result.tenantStats.planRows)).toEqual({
			monthly: 1,
			yearly: 1,
			'family-monthly': 0,
			'family-yearly': 0,
			lifetime: 1,
		});
		expect(result.tenantStats.unclassified).toBe(1);
	});

	// #4127 (3 instance 目): 実装 (ops-service.ts:69) は `monthStartJST()` 由来の JST 月初で
	// 「今月」を決めるが、本 test の fixture は `new Date(y, m, d)` = **実行環境ローカル TZ** の
	// 月で作られていた。CI (UTC) が UTC 月末の 15:00〜24:00 に走ると UTC 月 (例 7 月) と
	// JST 月 (8 月) が食い違い、「今月 5 日」のつもりの fixture が JST では先月になって 0 件になる。
	// 実測: TZ=UTC で fail / TZ=Asia/Tokyo で pass (2026-08-01 07:07 JST 時点)。
	// 実装側は JST で一貫しており本番の /ops KPI は正しい (欠陥は test の前提のみ)。
	//
	// 固定クロック + TZ pin で決定的にする (正解パターン: cohort-analysis-service.test.ts:75-113)。
	// 月央・正午 UTC に固定するため UTC と JST で年月が常に一致し、境界を跨がない。
	it('newThisMonth は当月作成のテナントをカウントする', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
		// TZ pin が効いていることの machine guard (vacuous 回帰の再発防止 / ADR-0061)。
		// この assert が落ちる = 下記 fixture が再び環境 TZ 依存に戻った、を即検出する。
		expect(new Date().toISOString().slice(0, 7)).toBe('2026-06');

		const thisMonthDate = new Date('2026-06-05T12:00:00Z').toISOString();
		const lastMonthDate = new Date('2026-05-15T12:00:00Z').toISOString();

		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', createdAt: thisMonthDate }),
			makeTenant({ tenantId: 't2', createdAt: thisMonthDate }),
			makeTenant({ tenantId: 't3', createdAt: lastMonthDate }),
		]);

		const result = await getKpiSummary();

		expect(result.tenantStats.newThisMonth).toBe(2);
		vi.useRealTimers();
	});

	// #4505: プレミアム (family monthly/yearly) は集計されているが描画側にプレミアム行が無く
	// テナントが不可視だった。行 (planRows) と合計 MRR の両方にプレミアムの寄与が乗ることを
	// 回帰確認する (行に出ているのに合計から欠ける、の裏返しも起きない)。
	it('familyMonthly/familyYearly の集計と MRR 寄与が正しく反映される (#4505)', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' }),
			makeTenant({ tenantId: 't2', status: 'active', plan: 'family-monthly' }),
			makeTenant({ tenantId: 't3', status: 'active', plan: 'family-monthly' }),
			makeTenant({ tenantId: 't4', status: 'active', plan: 'family-yearly' }),
		]);

		const result = await getKpiSummary();

		expect(planTenants(result.tenantStats.planRows)).toEqual({
			monthly: 1,
			yearly: 0,
			'family-monthly': 2,
			'family-yearly': 1,
			lifetime: 0,
		});

		// monthly: 1 * 500 = 500 / family-monthly: 2 * 780 = 1560 / family-yearly: 1 * round(7800/12) = 650
		expect(planMrr(result.tenantStats.planRows)).toEqual({
			monthly: 500,
			yearly: 0,
			'family-monthly': 1560,
			'family-yearly': 650,
			lifetime: 0,
		});
		expect(result.tenantStats.totalMrr).toBe(500 + 1560 + 650);
	});

	it('プレミアムが 0 件のときプレミアム行の MRR と合計への寄与は 0', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' }),
		]);

		const result = await getKpiSummary();

		expect(planMrr(result.tenantStats.planRows)).toEqual({
			monthly: 500,
			yearly: 0,
			'family-monthly': 0,
			'family-yearly': 0,
			lifetime: 0,
		});
		expect(result.tenantStats.totalMrr).toBe(500);
	});

	// #4505 の実害は「どの行にも出ないテナント」。行合計 + 未分類 = アクティブ数 を不変条件に
	// することで、プラン値が何であってもテナントが画面から消えない。
	it('プラン集合に無い plan 値のテナントも未分類として数える（行合計 + 未分類 = アクティブ）', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' }),
			// rename 途中の旧値 / 手動投入など、プラン集合に無い値。DB の plan 列は自由文字列
			// なので、型が塞いでいても**この境界を越えて入りうる** (cognito-dev の DEV_USERS も
			// 実際に underscore 形の値を返している)。cast はその境界の再現。
			makeTenant({
				tenantId: 't2',
				status: 'active',
				plan: 'family_monthly' as unknown as Tenant['plan'],
			}),
			makeTenant({ tenantId: 't3', status: 'active' }), // 未設定
		]);

		const result = await getKpiSummary();
		const { planRows, unclassified, active } = result.tenantStats;

		expect(unclassified).toBe(2); // 未知の plan 値 + 未設定
		expect(planRows.reduce((sum, r) => sum + r.tenants, 0) + unclassified).toBe(active);
		// 未知の値は MRR にも寄与しない (単価が引けないため)
		expect(result.tenantStats.totalMrr).toBe(500);
	});

	it('stripeEnabled が正しく反映される', async () => {
		mockListAllTenants.mockResolvedValue([]);
		mockIsStripeEnabled.mockReturnValue(true);

		const result = await getKpiSummary();

		expect(result.stripeEnabled).toBe(true);
	});

	it('fetchedAt が ISO 文字列として設定される', async () => {
		mockListAllTenants.mockResolvedValue([]);

		const result = await getKpiSummary();

		expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

// =============================================================
// generateSalesLedgerCsv
// =============================================================

describe('generateSalesLedgerCsv', () => {
	it('請求書が0件の場合、ヘッダ行のみ返す', () => {
		const csv = generateSalesLedgerCsv([]);
		const lines = csv.split('\n');

		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe('取引日,顧客ID（匿名化）,摘要,金額(税込),消費税,金額(税抜),備考');
	});

	it('複数の請求書を正しくCSV行に変換する', () => {
		const invoices: InvoiceRow[] = [
			{
				id: 'inv_001',
				customerId: 'cus_abcdefghijklmn',
				customerEmail: 'test@example.com',
				amount: 500,
				stripeFee: 58,
				paidAt: '2026-03-15T10:30:00Z',
				planDescription: 'がんばりクエスト 月額プラン',
			},
			{
				id: 'inv_002',
				customerId: 'cus_xyz123456789op',
				customerEmail: 'user@example.com',
				amount: 5000,
				stripeFee: 220,
				paidAt: '2026-03-20T14:00:00Z',
				planDescription: 'がんばりクエスト 年額プラン',
			},
		];

		const csv = generateSalesLedgerCsv(invoices);
		const lines = csv.split('\n');

		expect(lines).toHaveLength(3); // header + 2 rows
		expect(lines[1]).toBe(
			'2026-03-15,cus_abcdefgh...,がんばりクエスト 月額プラン,500,0,500,Stripe inv_001',
		);
		expect(lines[2]).toBe(
			'2026-03-20,cus_xyz12345...,がんばりクエスト 年額プラン,5000,0,5000,Stripe inv_002',
		);
	});

	it('customerId は先頭12文字 + ... に切り詰められる', () => {
		const invoices: InvoiceRow[] = [
			{
				id: 'inv_x',
				customerId: '123456789012345', // 15 chars
				customerEmail: '',
				amount: 100,
				stripeFee: 0,
				paidAt: '2026-01-01T00:00:00Z',
				planDescription: 'test',
			},
		];

		const csv = generateSalesLedgerCsv(invoices);
		const lines = csv.split('\n');
		const dataLine = lines[1] ?? '';

		expect(dataLine).toContain('123456789012...');
	});

	// #4120: 売上台帳は日本の事業の帳簿なので計上日は JST 暦日。
	// 旧実装は paidAt.slice(0, 10) = UTC 暦日で、JST 00:00〜09:00 に決済された分が
	// 前日 (年末なら前年) に計上されていた。
	it('paidAt から日付部分(YYYY-MM-DD)を JST 暦日で抽出する', () => {
		const row = (id: string, paidAt: string): InvoiceRow => ({
			id,
			customerId: 'cus_test',
			customerEmail: '',
			amount: 200,
			stripeFee: 0,
			paidAt,
			planDescription: 'plan',
		});

		// UTC 2026-12-25 23:59 = JST 2026-12-26 08:59 → JST 暦日は 12-26
		expect(
			generateSalesLedgerCsv([row('inv_d', '2026-12-25T23:59:59Z')]).split('\n')[1] ?? '',
		).toMatch(/^2026-12-26,/);
		// UTC 2026-12-25 12:00 = JST 21:00 → 同日
		expect(
			generateSalesLedgerCsv([row('inv_e', '2026-12-25T12:00:00Z')]).split('\n')[1] ?? '',
		).toMatch(/^2026-12-25,/);
	});

	it('paidAt が空の場合、日付欄は空文字になる', () => {
		const invoices: InvoiceRow[] = [
			{
				id: 'inv_empty',
				customerId: 'cus_test123456',
				customerEmail: '',
				amount: 300,
				stripeFee: 0,
				paidAt: '',
				planDescription: 'plan',
			},
		];

		const csv = generateSalesLedgerCsv(invoices);
		const lines = csv.split('\n');

		expect(lines[1] ?? '').toMatch(/^,cus_test1234/);
	});
});

// =============================================================
// generateExpenseLedgerCsv
// =============================================================

describe('generateExpenseLedgerCsv', () => {
	it('コスト0件 + Stripe手数料0の場合、ヘッダ行のみ返す', () => {
		const costs: AWSCostData = {
			month: '2026-03',
			services: [],
			total: 0,
			fetchedAt: '2026-03-28T00:00:00Z',
		};

		const csv = generateExpenseLedgerCsv(costs, 0, '2026-03');
		const lines = csv.split('\n');

		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe('取引日,勘定科目,摘要,金額(税込),消費税率,金額(税抜),支払先');
	});

	it('複数AWSサービスを正しくCSV行に変換する(USD→JPY ×150)', () => {
		const costs: AWSCostData = {
			month: '2026-03',
			services: [
				{ service: 'Amazon EC2', amount: 10.0, unit: 'USD' },
				{ service: 'Amazon S3', amount: 2.5, unit: 'USD' },
			],
			total: 12.5,
			fetchedAt: '2026-03-28T00:00:00Z',
		};

		const csv = generateExpenseLedgerCsv(costs, 0, '2026-03');
		const lines = csv.split('\n');

		expect(lines).toHaveLength(3); // header + 2 service rows

		// EC2: $10 * 150 = ¥1500, taxExcl = round(1500/1.1) = 1364
		expect(lines[1]).toBe(
			'2026-03-28,通信費,Amazon EC2（2026-03分）,1500,10%,1364,Amazon Web Services',
		);
		// S3: $2.5 * 150 = ¥375, taxExcl = round(375/1.1) = 341
		expect(lines[2]).toBe(
			'2026-03-28,通信費,Amazon S3（2026-03分）,375,10%,341,Amazon Web Services',
		);
	});

	it('Stripe手数料 > 0 の場合、手数料行が追加される', () => {
		const costs: AWSCostData = {
			month: '2026-03',
			services: [],
			total: 0,
			fetchedAt: '2026-03-28T00:00:00Z',
		};

		const csv = generateExpenseLedgerCsv(costs, 1200, '2026-03');
		const lines = csv.split('\n');

		expect(lines).toHaveLength(2); // header + stripe row

		// taxExcl = round(1200/1.1) = 1091
		expect(lines[1]).toBe(
			'2026-03-28,支払手数料,Stripe決済手数料（2026-03分）,1200,10%,1091,Stripe Inc.',
		);
	});

	it('AWSサービスとStripe手数料の両方がある場合、全行が含まれる', () => {
		const costs: AWSCostData = {
			month: '2026-04',
			services: [{ service: 'AWS Lambda', amount: 5.0, unit: 'USD' }],
			total: 5.0,
			fetchedAt: '2026-04-28T00:00:00Z',
		};

		const csv = generateExpenseLedgerCsv(costs, 500, '2026-04');
		const lines = csv.split('\n');

		expect(lines).toHaveLength(3); // header + Lambda + Stripe
		expect(lines[1]).toContain('AWS Lambda');
		expect(lines[2]).toContain('Stripe決済手数料');
	});

	it('税抜金額の計算: Math.round(jpy / 1.1)', () => {
		const costs: AWSCostData = {
			month: '2026-01',
			services: [{ service: 'TestService', amount: 7.77, unit: 'USD' }],
			total: 7.77,
			fetchedAt: '2026-01-28T00:00:00Z',
		};

		const csv = generateExpenseLedgerCsv(costs, 0, '2026-01');
		const lines = csv.split('\n');

		// $7.77 * 150 = ¥1165.5 → round = 1166 (Math.round)
		// actually: Math.round(7.77 * 150) = Math.round(1165.5) = 1166
		const jpy = Math.round(7.77 * 150);
		const taxExcl = Math.round(jpy / 1.1);
		expect(lines[1]).toBe(
			`2026-01-28,通信費,TestService（2026-01分）,${jpy},10%,${taxExcl},Amazon Web Services`,
		);
	});
});

// =============================================================
// generatePLSummary
// =============================================================

describe('generatePLSummary', () => {
	function makeRevenueData(overrides: Partial<RevenueData> = {}): RevenueData {
		return {
			invoices: [],
			totalRevenue: 0,
			totalStripeFees: 0,
			monthlyBreakdown: [],
			mrr: 0,
			arr: 0,
			...overrides,
		};
	}

	function makeCostData(overrides: Partial<AWSCostData> = {}): AWSCostData {
		return {
			month: '2026-03',
			services: [],
			total: 0,
			fetchedAt: '2026-03-28T00:00:00Z',
			...overrides,
		};
	}

	it('月名が含まれる', () => {
		const summary = generatePLSummary(makeRevenueData(), makeCostData({ month: '2026-04' }));

		expect(summary).toContain('2026-04');
	});

	it('収入・経費・利益が含まれる', () => {
		const revenue = makeRevenueData({
			totalRevenue: 10000,
			totalStripeFees: 400,
		});
		const costs = makeCostData({ total: 20 }); // $20 * 150 = ¥3000

		const summary = generatePLSummary(revenue, costs);

		expect(summary).toContain('10,000'); // revenue
		expect(summary).toContain('3,000'); // AWS cost in JPY
		expect(summary).toContain('400'); // Stripe fees
	});

	it('利益 = totalRevenue - totalStripeFees - (costs.total * 150)', () => {
		const revenue = makeRevenueData({
			totalRevenue: 50000,
			totalStripeFees: 2000,
		});
		const costs = makeCostData({ total: 100 }); // $100 * 150 = ¥15000

		const expectedProfit = 50000 - 2000 - Math.round(100 * 150);
		const summary = generatePLSummary(revenue, costs);

		expect(summary).toContain(expectedProfit.toLocaleString());
	});

	it('利益がマイナスの場合も正しく表示される', () => {
		const revenue = makeRevenueData({
			totalRevenue: 1000,
			totalStripeFees: 500,
		});
		const costs = makeCostData({ total: 50 }); // $50 * 150 = ¥7500

		const expectedProfit = 1000 - 500 - Math.round(50 * 150); // = -7000
		expect(expectedProfit).toBeLessThan(0);

		const summary = generatePLSummary(revenue, costs);

		expect(summary).toContain(expectedProfit.toLocaleString());
	});

	it('免責テキスト（青色申告特別控除等）が含まれる', () => {
		const summary = generatePLSummary(makeRevenueData(), makeCostData());

		expect(summary).toContain('青色申告特別控除');
		expect(summary).toContain('概算値');
	});

	it('収入0・経費0の場合、利益0で正しくフォーマットされる', () => {
		const summary = generatePLSummary(makeRevenueData(), makeCostData());

		// Profit should be 0
		expect(summary).toContain('差引利益');
		expect(summary).toContain('事業収支サマリー');
	});
});

// =============================================================
// getRevenueData (Stripe 無効パス)
// =============================================================

describe('getRevenueData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Stripe無効の場合、空のRevenueDataを返す', async () => {
		mockIsStripeEnabled.mockReturnValue(false);

		const from = new Date('2026-01-01');
		const to = new Date('2026-01-31');
		const result = await getRevenueData(from, to);

		expect(result).toEqual({
			invoices: [],
			totalRevenue: 0,
			totalStripeFees: 0,
			monthlyBreakdown: [],
			mrr: 0,
			arr: 0,
		});
	});
});
