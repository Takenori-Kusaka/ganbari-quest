// tests/unit/services/stripe-webhook-contract-state.test.ts
// EPIC #4118 手 2 — webhook handler 適用後の 4 列が「表に在る状態」に収まることを固定する。
//
// ## なぜ必要か
//
// `docs/design/billing-redesign/contract-state-matrix.md` §7 が実装方針を 3 手に分けている。
//
//   1. ドメイン層に S1-S6 / X1-X4 と `classifyContractState()` を置く（#4181 / PR #4233）
//   2. **各 webhook handler の unit test で「適用後の行が S1-S6 に分類される」ことを assert する**  ← 本 file
//   3. 定期監査で本番行を分類し X1-X4 を報告する
//
// 手 2 が「**意図と効果の乖離**」を落とす本体である（matrix §7 の記述）。
// `updateTenantStripe` は **部分更新**（`undefined` = その列を更新しない）であり、
// handler の意図としては正しく見えても「書き忘れた列が前の値のまま残る」ことで
// 不正状態 (X1-X4) が生まれる。実際 #4026 では、cancel が `planExpiresAt` を書いた直後の
// `deleted` が同列を書かず「契約が無いのに期限だけ残る」(X3) を作っていた。
//
// **静的解析では捕まえられない**（部分更新の効果は「適用前の行」と合成しないと決まらない）ため、
// handler を実際に走らせ、捕獲した patch を適用前の行にマージして分類する。
//
// ## no-silent-gap
//
// 新しい webhook handler が dispatcher に増えたのに本 file の網羅から漏れると、
// 「表に無い状態を作る handler」が検査されないまま入る。dispatcher の `case` を
// **source から抽出**して、本 file が覆う event 型と突き合わせる。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	type ContractStateColumns,
	classifyContractState,
	VALID_CONTRACT_STATES,
} from '../../../src/lib/domain/contract-state';

// ---------- Mocks（stripe-service.test.ts と同型） ----------

const mockFindTenantById = vi.fn();
const mockUpdateTenantStripe = vi.fn();
const mockFindTenantByStripeCustomerId = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantById: mockFindTenantById,
			updateTenantStripe: mockUpdateTenantStripe,
			findTenantByStripeCustomerId: mockFindTenantByStripeCustomerId,
		},
		webhookEvent: {
			findByEventId: async () => null,
			claim: async () => true,
			finalize: async () => {},
			releaseClaim: async () => {},
			incrementRetryCount: async () => {},
			deleteOlderThan: async () => 0,
		},
	}),
}));

const mockIsStripeEnabled = vi.fn();
const mockGetStripeClient = vi.fn();

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: (...args: unknown[]) => mockIsStripeEnabled(...args),
	getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
}));

vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({
		monthly: { priceId: 'price_monthly_123', amount: 500, interval: 'month', label: '月額' },
		'family-monthly': {
			priceId: 'price_family_monthly_789',
			amount: 780,
			interval: 'month',
			label: 'プレミアム月額',
		},
	}),
	planIdFromPriceId: (priceId: string) => {
		if (priceId === 'price_monthly_123') return 'monthly';
		if (priceId === 'price_family_monthly_789') return 'family-monthly';
		return null;
	},
	planIdFromLookupKey: () => null,
	getWebhookSecret: () => 'whsec_test',
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

vi.mock('$lib/server/stripe/alert', () => ({ notifyStripeAlert: vi.fn() }));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyBillingEvent: vi.fn().mockResolvedValue(undefined),
}));

import { handleWebhookEvent } from '../../../src/lib/server/services/stripe-service';

// ---------- Helpers ----------

const SUB_ID = 'sub_contract_state';

/** 適用前の行（S2 = 課金中）。各 case で必要な列だけ上書きする。 */
function rowBefore(overrides: Partial<ContractStateColumns> = {}): ContractStateColumns {
	return {
		status: 'active',
		plan: 'monthly',
		stripeSubscriptionId: SUB_ID,
		planExpiresAt: null,
		...overrides,
	};
}

function tenantFrom(row: ContractStateColumns) {
	return {
		tenantId: 't-cs',
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: row.status,
		plan: row.plan,
		stripeCustomerId: 'cus_cs',
		stripeSubscriptionId: row.stripeSubscriptionId,
		planExpiresAt: row.planExpiresAt,
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
	};
}

/**
 * `updateTenantStripe` の**部分更新セマンティクス**を再現して適用後の行を作る。
 *
 * `undefined` は「更新しない」。`null` は「NULL を書く」。この区別を潰すと、
 * 「書き忘れた列が前の値のまま残る」という検出したい欠陥がそのまま消える。
 */
function applyPatch(
	before: ContractStateColumns,
	patch: Record<string, unknown>,
): ContractStateColumns {
	const pick = <K extends keyof ContractStateColumns>(key: K): ContractStateColumns[K] =>
		patch[key as string] === undefined
			? before[key]
			: (patch[key as string] as ContractStateColumns[K]);
	return {
		status: pick('status'),
		plan: pick('plan'),
		stripeSubscriptionId: pick('stripeSubscriptionId'),
		planExpiresAt: pick('planExpiresAt'),
	};
}

/** handler を 1 回走らせ、書き込まれた patch を返す（書かなければ null）。 */
async function runAndCapturePatch(
	before: ContractStateColumns,
	// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
	event: any,
): Promise<Record<string, unknown> | null> {
	const tenant = tenantFrom(before);
	mockFindTenantById.mockResolvedValue(tenant);
	mockFindTenantByStripeCustomerId.mockResolvedValue(tenant);
	mockUpdateTenantStripe.mockResolvedValue(undefined);

	await handleWebhookEvent(event);

	if (mockUpdateTenantStripe.mock.calls.length === 0) return null;
	const last = mockUpdateTenantStripe.mock.calls.at(-1);
	return (last?.[1] ?? {}) as Record<string, unknown>;
}

/** 適用後の行が「表に在る状態」であることを assert する。 */
function expectValidAfter(
	before: ContractStateColumns,
	patch: Record<string, unknown> | null,
	label: string,
): void {
	expect(
		patch,
		`${label}: 契約状態が書き込まれませんでした（fixture が handler に届いていません）`,
	).not.toBeNull();
	const after = applyPatch(before, patch ?? {});
	const classification = classifyContractState(after);
	expect(
		VALID_CONTRACT_STATES.includes(classification as (typeof VALID_CONTRACT_STATES)[number]),
		`${label}: 適用後の 4 列が表に無い状態 (${classification}) になりました。\n` +
			`  before = ${JSON.stringify(before)}\n` +
			`  patch  = ${JSON.stringify(patch)}\n` +
			`  after  = ${JSON.stringify(after)}\n` +
			'部分更新 (undefined = 更新しない) で書き忘れた列が残っていないか確認してください',
	).toBe(true);
}

// ---------- Fixtures ----------

function subscriptionEvent(type: string, overrides: Record<string, unknown> = {}) {
	return {
		id: `evt_${type}`,
		type,
		data: {
			object: {
				id: SUB_ID,
				customer: 'cus_cs',
				status: 'active',
				items: { data: [{ price: { id: 'price_monthly_123' } }] },
				current_period_end: Math.floor(Date.UTC(2026, 8, 1) / 1000),
				cancel_at_period_end: false,
				...overrides,
			},
		},
	};
}

function invoiceEvent(type: string) {
	return {
		id: `evt_${type}`,
		type,
		data: {
			object: {
				id: 'in_cs',
				customer: 'cus_cs',
				// extractSubscriptionId は parent.subscription_details 経由でしか解決しない
				parent: { subscription_details: { subscription: SUB_ID } },
				lines: { data: [{ price: { id: 'price_monthly_123' } }] },
			},
		},
	};
}

/** 本 file が覆う event 型（dispatcher の case と突き合わせる）。 */
const COVERED_EVENT_TYPES = [
	'checkout.session.completed',
	'invoice.paid',
	'invoice.payment_failed',
	'customer.subscription.updated',
	'customer.subscription.deleted',
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
	mockGetStripeClient.mockReturnValue({
		subscriptions: {
			retrieve: vi.fn().mockResolvedValue({
				id: SUB_ID,
				customer: 'cus_cs',
				status: 'active',
				items: { data: [{ price: { id: 'price_monthly_123' } }] },
				current_period_end: Math.floor(Date.UTC(2026, 8, 1) / 1000),
				cancel_at_period_end: false,
			}),
		},
	});
});

describe('#4118 手 2: webhook 適用後の契約状態が表に在ること', () => {
	it('no-silent-gap: dispatcher が扱う event 型を全件覆っている', () => {
		const source = readFileSync(
			join(__dirname, '../../../src/lib/server/services/stripe-service.ts'),
			'utf-8',
		);
		const dispatchIdx = source.indexOf('async function dispatchWebhookEvent');
		expect(dispatchIdx, 'dispatchWebhookEvent が見つかりません').toBeGreaterThan(0);
		const body = source.slice(dispatchIdx, source.indexOf('\n}', dispatchIdx));
		const handled = [...body.matchAll(/case '([^']+)':/g)].map((m) => m[1]).sort();

		expect(handled.length, 'dispatcher の case が 0 件です').toBeGreaterThan(0);
		expect(
			handled,
			'dispatcher が扱う event 型と本 file の網羅がずれています。' +
				'新しい handler を足したら、適用後の行が S1-S6 に収まることを本 file でも固定してください',
		).toEqual([...COVERED_EVENT_TYPES].sort());
	});

	it('invoice.paid: 課金中 (S2) に収まる', async () => {
		const before = rowBefore({ status: 'grace_period', planExpiresAt: '2026-09-01T00:00:00Z' });
		const patch = await runAndCapturePatch(before, invoiceEvent('invoice.paid'));
		expectValidAfter(before, patch, 'invoice.paid');
	});

	it('invoice.payment_failed: 支払い失敗猶予 (S3) に収まる', async () => {
		const before = rowBefore();
		const patch = await runAndCapturePatch(before, invoiceEvent('invoice.payment_failed'));
		expectValidAfter(before, patch, 'invoice.payment_failed');
	});

	it('customer.subscription.updated: 表に在る状態に収まる', async () => {
		const before = rowBefore({ status: 'grace_period', planExpiresAt: '2026-09-01T00:00:00Z' });
		const patch = await runAndCapturePatch(
			before,
			subscriptionEvent('customer.subscription.updated'),
		);
		expectValidAfter(before, patch, 'customer.subscription.updated');
	});

	it('customer.subscription.deleted: 契約終了 (S5) に収まる — 期限だけ残る X3 を作らない', async () => {
		// #4026 の実害を再現する初期状態: cancel が planExpiresAt を書いた直後
		const before = rowBefore({ status: 'grace_period', planExpiresAt: '2026-09-01T00:00:00Z' });
		const patch = await runAndCapturePatch(
			before,
			subscriptionEvent('customer.subscription.deleted', { status: 'canceled' }),
		);
		expectValidAfter(before, patch, 'customer.subscription.deleted');
	});
});
