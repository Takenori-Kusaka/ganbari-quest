// tests/unit/routes/ops-export-authz.test.ts
// #4309: /ops/export (売上台帳 / 費用台帳 / PL サマリの CSV エクスポート) が
//        未認証で 200 + 実データを返していた欠陥の回帰テスト。
//
// 何が壊れていたか:
//   `/ops` はグローバル認可層 (authorizeCognito → isPublicRoute) を意図的に通過させ、
//   保護を `src/routes/ops/+layout.server.ts` の ops gate (#4266 ops group + MFA) に委ねている。
//   しかし **SvelteKit の `+layout.server.ts` は page (`+page.svelte`) の load にしか適用されず、
//   `+server.ts` (API endpoint) には走らない**。`/ops/export/+server.ts` には認可が 1 行も無く、
//   cookie 無し・認証ヘッダ無しの `GET /ops/export?type=sales&year=2026` が staging で
//   **200 + 実顧客の売上台帳 CSV** を返していた (2026-08-06 実証、#4309)。
//
// failing-test-first (ADR-0061): 修正前は「未認証は 403」系の it が **200 を返して red**、
//   かつ mock service が呼ばれてしまう (= データ生成まで到達している) ことも検出する。
//
// 検証観点:
//   - 未認証 / 非 ops / ops だが MFA 未済 → 403。かつ **service 層に一切到達しない**
//     (403 を返すだけで裏で集計クエリが走るなら、認可は「表示の抑制」でしかない)
//   - type=sales / expenses / summary の **3 種すべて**で塞がっている (同一ハンドラの分岐漏れ防止)
//   - 正規の ops ユーザ (ops group + MFA) では従来どおり CSV / TXT が 200 で取れる (回帰)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

// ---------- mocks ----------
// service 層は Stripe / AWS Cost Explorer を叩くため全 mock。
// 「認可で弾かれたなら 1 度も呼ばれない」ことを assert するための spy でもある。

const mockGetRevenueData = vi.fn();
const mockGetAWSCostData = vi.fn();
const mockGenerateSalesLedgerCsv = vi.fn();
const mockGenerateExpenseLedgerCsv = vi.fn();
const mockGeneratePLSummary = vi.fn();

vi.mock('$lib/server/services/ops-service', () => ({
	getRevenueData: (...args: unknown[]) => mockGetRevenueData(...args),
	getAWSCostData: (...args: unknown[]) => mockGetAWSCostData(...args),
	generateSalesLedgerCsv: (...args: unknown[]) => mockGenerateSalesLedgerCsv(...args),
	generateExpenseLedgerCsv: (...args: unknown[]) => mockGenerateExpenseLedgerCsv(...args),
	generatePLSummary: (...args: unknown[]) => mockGeneratePLSummary(...args),
}));

const { GET } = await import('../../../src/routes/ops/export/+server');

// ---------- fixtures ----------

const OPS_WITH_MFA: Identity = {
	type: 'cognito',
	userId: 'u-ops-1',
	email: 'ops@example.com',
	groups: ['ops'],
	mfaAuthenticated: true,
};

/** ops group には居るが MFA を経ていない (#4266 fail-closed の対象) */
const OPS_WITHOUT_MFA: Identity = {
	type: 'cognito',
	userId: 'u-ops-2',
	email: 'ops2@example.com',
	groups: ['ops'],
	mfaAuthenticated: false,
};

/** 通常の顧客 (保護者)。ops group 非所属 */
const PARENT: Identity = {
	type: 'cognito',
	userId: 'u-parent',
	email: 'parent@example.com',
	groups: [],
	mfaAuthenticated: true,
};

const EXPORT_TYPES = ['sales', 'expenses', 'summary'] as const;

function makeEvent(type: string, identity: Identity | null, context?: Partial<AuthContext> | null) {
	return {
		url: new URL(`http://localhost/ops/export?type=${type}&year=2026`),
		locals: { identity, context: context ?? null },
	} as unknown as Parameters<typeof GET>[0];
}

/** handler を呼び、`error()` が throw する HttpError の status を取り出す */
async function statusOf(event: Parameters<typeof GET>[0]): Promise<number> {
	try {
		const res = await GET(event);
		return res.status;
	} catch (e) {
		const status = (e as { status?: number }).status;
		if (typeof status !== 'number') throw e;
		return status;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetRevenueData.mockResolvedValue({ invoices: [], monthlyBreakdown: [] });
	mockGetAWSCostData.mockResolvedValue({});
	mockGenerateSalesLedgerCsv.mockReturnValue('取引日,顧客ID（匿名化）\n');
	mockGenerateExpenseLedgerCsv.mockReturnValue('取引日,勘定科目\n');
	mockGeneratePLSummary.mockReturnValue('PL サマリ');
});

describe('/ops/export の認可 (#4309)', () => {
	describe('未認証は 3 種すべてで 403 (staging で 200 + 実データが返っていた)', () => {
		for (const type of EXPORT_TYPES) {
			it(`type=${type} は 403 を返す`, async () => {
				expect(await statusOf(makeEvent(type, null))).toBe(403);
			});

			it(`type=${type} は service 層に到達しない`, async () => {
				await statusOf(makeEvent(type, null));
				// 403 を返しつつ裏で集計が走るなら、認可ではなく「表示の抑制」でしかない。
				expect(mockGetRevenueData).not.toHaveBeenCalled();
				expect(mockGetAWSCostData).not.toHaveBeenCalled();
			});
		}
	});

	describe('ops group 非所属 (通常の顧客) は 3 種すべてで 403', () => {
		for (const type of EXPORT_TYPES) {
			it(`type=${type} は 403 を返す`, async () => {
				expect(await statusOf(makeEvent(type, PARENT))).toBe(403);
				expect(mockGetRevenueData).not.toHaveBeenCalled();
			});
		}
	});

	describe('ops group だが MFA 未済は 403 (#4266 fail-closed を API にも適用)', () => {
		for (const type of EXPORT_TYPES) {
			it(`type=${type} は 403 を返す`, async () => {
				expect(await statusOf(makeEvent(type, OPS_WITHOUT_MFA))).toBe(403);
				expect(mockGetRevenueData).not.toHaveBeenCalled();
			});
		}
	});

	describe('正規の ops ユーザは従来どおり取得できる (塞ぎすぎて運用が止まらないこと)', () => {
		for (const type of EXPORT_TYPES) {
			it(`type=${type} は 200 を返す`, async () => {
				const res = await GET(makeEvent(type, OPS_WITH_MFA));
				expect(res.status).toBe(200);
				expect(await res.text()).not.toBe('');
			});
		}

		it('token 側に MFA claim が無くても、session context が MFA 済なら通る (silent refresh 対策)', async () => {
			// hasOpsAccess は identity(token) と context(session) の OR を取る (#4266)。
			// 片側だけを見ると、無操作の運営者が silent refresh で締め出される。
			const identityWithoutMfaClaim: Identity = {
				type: 'cognito',
				userId: 'u-ops-3',
				email: 'ops3@example.com',
				groups: ['ops'],
			};
			const res = await GET(
				makeEvent('sales', identityWithoutMfaClaim, { mfaAuthenticated: true }),
			);
			expect(res.status).toBe(200);
		});
	});
});
