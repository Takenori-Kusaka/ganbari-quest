// tests/unit/services/stripe-contract-state-classification.test.ts
// #4181 AC3 — webhook handler が書き込んだ後の 4 列が、**必ず正常状態 (S1〜S6) に分類される**。
//
// ## 何を守るか
//
// `contract-state-matrix.md` §5 が数える書き手は 9 箇所ある。表は「どの組み合わせが正しいか」を
// 人間向けに書いたもので、**handler が表に無い組み合わせを書いても誰も気づかない**。
// 実際に過去、`/api/v1/admin/tenant/cancel` が `status=grace_period` + `planExpiresAt=+30d` を
// 書いた直後の `deleted` が `planExpiresAt` を書かず、**契約が無いのに期限だけ残る (X3)** を作っていた
// (#4026 で `TERMINAL_CONTRACT_STATE` に集約して解消)。
//
// **本 test は「書いた後の状態」を分類し、X1〜X4 に落ちたら fail する。**
// これが「表に無い遷移の機械検出」の実体である (matrix §7 手順②)。
//
// ## なぜ patch を merge してから分類するか
//
// `updateTenantStripe` は **差分 patch** を受け取り、`undefined` の列は「更新しない」を意味する。
// patch 単体を分類すると、更新しなかった列を「なし」と誤読して**実在しない不正状態**を作る。
// 実際の行は「更新前の行 + patch」なので、そのとおり merge してから分類する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Mocks (stripe-service.test.ts と同型) ----------

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

// handler は plan / status を **subscription の現行値**から解決するため retrieve が要る (#3960)。
const mockSubscriptionsRetrieve = vi.fn();
vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => true,
	getStripeClient: () => ({ subscriptions: { retrieve: mockSubscriptionsRetrieve } }),
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
	planIdFromPriceId: (priceId: string) =>
		priceId === 'price_monthly_123'
			? 'monthly'
			: priceId === 'price_family_monthly_789'
				? 'family-monthly'
				: null,
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
	notifyDiscord: vi.fn(),
	notifyIncident: vi.fn(),
}));

// ---------- Import after mocks ----------

import {
	type ContractStateClassification,
	type ContractStateColumns,
	classifyContractState,
	isInvalidContractState,
	VALID_CONTRACT_STATES,
} from '$lib/domain/contract-state';
import { handleWebhookEvent } from '../../../src/lib/server/services/stripe-service';

// ---------- Helpers ----------

const SUB = 'sub_current';

function makeTenant(overrides: Record<string, unknown> = {}) {
	return {
		tenantId: 't-test',
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: 'active',
		plan: 'monthly',
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: SUB,
		planExpiresAt: null,
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

/**
 * 「更新前の行 + patch」を作る。`undefined` は「更新しない」なので**上書きしない**。
 */
function mergePatch(
	before: Record<string, unknown>,
	patch: Record<string, unknown>,
): ContractStateColumns {
	const merged = { ...before };
	for (const [k, v] of Object.entries(patch)) {
		if (v !== undefined) merged[k] = v;
	}
	return {
		status: String(merged.status),
		plan: (merged.plan ?? null) as string | null,
		stripeSubscriptionId: (merged.stripeSubscriptionId ?? null) as string | null,
		planExpiresAt: (merged.planExpiresAt ?? null) as string | null,
	};
}

/** handler が書いた patch をすべて順に適用し、最終的な 4 列を返す。 */
function resultingColumns(before: Record<string, unknown>): ContractStateColumns {
	let columns = before;
	for (const call of mockUpdateTenantStripe.mock.calls) {
		columns = { ...columns, ...{} };
		const patch = call[1] as Record<string, unknown>;
		const merged = mergePatch(columns, patch);
		columns = { ...columns, ...merged };
	}
	return mergePatch(columns, {});
}

/**
 * 「書いた後の行が **S1〜S6 のいずれか** である」ことを assert する (AC3)。
 *
 * `isInvalidContractState()` だけでは足りない。同関数は `UNCLASSIFIED`
 * (= 表がまだ何も言っていない組み合わせ) に対して **false** を返すため、
 * 「X* ではない」だけを見ると **表に無い状態を書いた handler が緑で通る**。
 * 本 Issue が塞ぐのは「表に無い遷移」そのものなので、正常集合への所属を直接見る。
 */
function expectWritesValidState(writer: string, after: ContractStateClassification): void {
	expect(
		(VALID_CONTRACT_STATES as readonly string[]).includes(after),
		`${writer} が表に無い / 不正な状態 ${after} を書いた (S1〜S6 のいずれかである必要がある)`,
	).toBe(true);
	expect(isInvalidContractState(after), `${writer} が不正状態 ${after} を書いた`).toBe(false);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindTenantByStripeCustomerId.mockResolvedValue(null);
	mockSubscriptionsRetrieve.mockResolvedValue({
		id: SUB,
		customer: 'cus_123',
		status: 'past_due',
		items: { data: [{ price: { id: 'price_monthly_123' } }] },
	});
});

// ---------- W1〜W5 (matrix §5) ----------

describe('#4181 AC3 webhook handler の書き込み後は正常状態に分類される', () => {
	it('W1 checkout.session.completed: S1 (未課金) → S2 (課金中)', async () => {
		const before = makeTenant({ plan: null, stripeSubscriptionId: null });
		expect(classifyContractState(mergePatch(before, {})), '前提が S1 でない').toBe('S1');
		mockFindTenantById.mockResolvedValue(before);

		await handleWebhookEvent({
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test',
					metadata: { tenantId: 't-test', planId: 'monthly' },
					customer: 'cus_123',
					subscription: SUB,
					customer_details: { email: 'test@example.com' },
					customer_email: null,
				},
			},
		} as never);

		expect(mockUpdateTenantStripe, 'W1 が書き込んでいない').toHaveBeenCalled();
		const after = classifyContractState(resultingColumns(before));
		expect(isInvalidContractState(after), `W1 が不正状態 ${after} を書いた`).toBe(false);
		expect(after).toBe('S2');
	});

	it('W3 invoice.payment_failed: S2 (課金中) → S3 (支払い失敗猶予)', async () => {
		const before = makeTenant();
		mockFindTenantById.mockResolvedValue(before);
		mockFindTenantByStripeCustomerId.mockResolvedValue(before);

		await handleWebhookEvent({
			type: 'invoice.payment_failed',
			data: {
				// 実 Stripe の invoice は subscription を parent.subscription_details に持つ
				object: {
					id: 'in_test',
					customer: 'cus_123',
					parent: { subscription_details: { subscription: SUB } },
				},
			},
		} as never);

		expect(mockUpdateTenantStripe, 'W3 が書き込んでいない').toHaveBeenCalled();
		const after = classifyContractState(resultingColumns(before));
		expect(isInvalidContractState(after), `W3 が不正状態 ${after} を書いた`).toBe(false);
		expect(after).toBe('S3');
	});

	it('W5 customer.subscription.deleted: S2/S3 → S5 (契約終了)', async () => {
		// 猶予中 (S3) から解約されるケース。**旧実装が X3 を作っていた経路** (#4026)
		const before = makeTenant({
			status: 'grace_period',
			planExpiresAt: '2026-09-01T00:00:00.000Z',
		});
		expect(classifyContractState(mergePatch(before, {})), '前提が S3 でない').toBe('S3');
		mockFindTenantById.mockResolvedValue(before);
		mockFindTenantByStripeCustomerId.mockResolvedValue(before);

		await handleWebhookEvent({
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: SUB,
					customer: 'cus_123',
					status: 'canceled',
					metadata: { tenantId: 't-test' },
				},
			},
		} as never);

		expect(mockUpdateTenantStripe, 'W5 が書き込んでいない').toHaveBeenCalled();
		const after = classifyContractState(resultingColumns(before));
		expect(
			isInvalidContractState(after),
			`W5 が不正状態 ${after} を書いた。終端は 4 列を網羅的に書く必要がある (#4026)`,
		).toBe(false);
		expect(after).toBe('S5');
	});
	it('W2 invoice.paid: S3 (猶予) → S2 (課金中)', async () => {
		// 支払い成功で猶予から復帰する経路。**猶予終了日を消さないと X3** になる
		// (`active` に期限は無い、matrix §4)。顧客には「支払い済みなのに期限が迫っている」と映る。
		const before = makeTenant({
			status: 'grace_period',
			planExpiresAt: '2026-09-01T00:00:00.000Z',
		});
		expect(classifyContractState(mergePatch(before, {})), '前提が S3 でない').toBe('S3');
		mockFindTenantById.mockResolvedValue(before);
		mockFindTenantByStripeCustomerId.mockResolvedValue(before);
		mockSubscriptionsRetrieve.mockResolvedValue({
			id: SUB,
			customer: 'cus_123',
			status: 'active',
			items: { data: [{ price: { id: 'price_monthly_123' } }] },
		});

		await handleWebhookEvent({
			type: 'invoice.paid',
			data: {
				object: {
					id: 'in_paid',
					customer: 'cus_123',
					parent: { subscription_details: { subscription: SUB } },
				},
			},
		} as never);

		expect(mockUpdateTenantStripe, 'W2 が書き込んでいない').toHaveBeenCalled();
		const after = classifyContractState(resultingColumns(before));
		expectWritesValidState('W2', after);
		expect(after).toBe('S2');
	});

	it('W4 customer.subscription.updated: S3 (猶予) → S2 (課金中) に復帰', async () => {
		const before = makeTenant({
			status: 'grace_period',
			planExpiresAt: '2026-09-01T00:00:00.000Z',
		});
		mockFindTenantById.mockResolvedValue(before);

		await handleWebhookEvent({
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: SUB,
					metadata: { tenantId: 't-test' },
					status: 'active',
					items: { data: [{ price: { id: 'price_monthly_123' } }] },
				},
			},
		} as never);

		expect(mockUpdateTenantStripe, 'W4 が書き込んでいない').toHaveBeenCalled();
		const after = classifyContractState(resultingColumns(before));
		expectWritesValidState('W4 (active 復帰)', after);
		expect(after).toBe('S2');
	});

	it('W4 customer.subscription.updated: S2 (課金中) → S3 (past_due で猶予入り)', async () => {
		// Stripe は `invoice.payment_failed` (W3) と `past_due` の `updated` (W4) を両方送り、
		// **到着順を保証しない**。W4 が先着したとき猶予終了日を書かないと
		// `grace_period` + 期限なし = **表に無い組み合わせ**になる (S3 は exp あり必須)。
		// 顧客の画面には「いつまで猶予なのか」が出せず、W3 が届かなければ猶予が明けない。
		const before = makeTenant();
		expect(classifyContractState(mergePatch(before, {})), '前提が S2 でない').toBe('S2');
		mockFindTenantById.mockResolvedValue(before);

		await handleWebhookEvent({
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: SUB,
					metadata: { tenantId: 't-test' },
					status: 'past_due',
					items: { data: [{ price: { id: 'price_monthly_123' } }] },
				},
			},
		} as never);

		expect(mockUpdateTenantStripe, 'W4 が書き込んでいない').toHaveBeenCalled();
		const after = classifyContractState(resultingColumns(before));
		expectWritesValidState('W4 (past_due)', after);
		expect(after).toBe('S3');
	});

	it('W4 customer.subscription.updated: S3 の猶予終了日は past_due の再送で延長されない', async () => {
		// dunning 中 Stripe は retry のたび `past_due` の updated を送る。毎回 now+7d を書くと
		// **猶予が無限に伸びて未払いのまま使い続けられる**。既に期限があるなら触らない。
		const existingExpiry = '2026-09-01T00:00:00.000Z';
		const before = makeTenant({ status: 'grace_period', planExpiresAt: existingExpiry });
		mockFindTenantById.mockResolvedValue(before);

		await handleWebhookEvent({
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: SUB,
					metadata: { tenantId: 't-test' },
					status: 'past_due',
					items: { data: [{ price: { id: 'price_monthly_123' } }] },
				},
			},
		} as never);

		const after = resultingColumns(before);
		expect(after.planExpiresAt, '猶予終了日が再送で書き換わっている').toBe(existingExpiry);
		expectWritesValidState('W4 (past_due 再送)', classifyContractState(after));
	});
});

// ---------- #4416: 猶予終了日を書く 2 経路 (W3 / W4) が同じ規則に従う ----------

describe('#4416 猶予終了日は「最初の支払い失敗から 7 日」で固定される', () => {
	/** dunning 中の tenant (既に猶予終了日が立っている)。 */
	const EXISTING_EXPIRY = '2026-09-01T00:00:00.000Z';

	// `Date` だけを固定する。`setTimeout` まで止めると handler 内の await が進まなくなる。
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	/** W3 (`invoice.payment_failed`) を 1 回起こす。 */
	async function firePaymentFailed(): Promise<void> {
		await handleWebhookEvent({
			type: 'invoice.payment_failed',
			data: {
				object: {
					id: 'in_test',
					customer: 'cus_123',
					parent: { subscription_details: { subscription: SUB } },
				},
			},
		} as never);
	}

	/** W4 (`customer.subscription.updated` status=past_due) を 1 回起こす。 */
	async function fireSubscriptionPastDue(): Promise<void> {
		await handleWebhookEvent({
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: SUB,
					metadata: { tenantId: 't-test' },
					status: 'past_due',
					items: { data: [{ price: { id: 'price_monthly_123' } }] },
				},
			},
		} as never);
	}

	it('W3 の再送 (dunning retry) は猶予終了日を延長しない', async () => {
		// Stripe の dunning は 1 回の失敗で終わらず、**同じ invoice を複数回 retry して
		// そのたび `invoice.payment_failed` を送る**。毎回 now+7d を書き直すと猶予が先送りされ続け、
		// **支払い失敗が続いている間は 7 日の猶予が実質切れない**。
		const before = makeTenant({ status: 'grace_period', planExpiresAt: EXISTING_EXPIRY });
		mockFindTenantById.mockResolvedValue(before);
		mockFindTenantByStripeCustomerId.mockResolvedValue(before);

		await firePaymentFailed();

		const after = resultingColumns(before);
		expect(after.planExpiresAt, 'W3 の再送で猶予終了日が延びている').toBe(EXISTING_EXPIRY);
		expectWritesValidState('W3 (payment_failed 再送)', classifyContractState(after));
	});

	it('W3 の初回 (猶予終了日なし) は now+7d を与える', async () => {
		// 「延長しない」は「与えない」ではない。S3 は `exp` あり必須なので、
		// 期限が無い状態から猶予に入るときは必ず立てる。
		const before = makeTenant();
		mockFindTenantById.mockResolvedValue(before);
		mockFindTenantByStripeCustomerId.mockResolvedValue(before);
		const nowMs = Date.parse('2026-08-01T00:00:00.000Z');
		vi.setSystemTime(nowMs);

		await firePaymentFailed();

		const after = resultingColumns(before);
		expect(after.planExpiresAt, 'W3 の初回で猶予終了日が立っていない').toBe(
			new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
		);
		expect(classifyContractState(after)).toBe('S3');
	});

	it('W3 と W4 は同じ規則に従う (同じ入力に同じ猶予終了日を書く)', async () => {
		// 本 Issue の本体。**同じ概念を書く 2 箇所が逆方針**だと、片方だけを読む処理を足したときに壊れる。
		// 「初回は与える / 再送では延ばさない」を 2 経路とも満たすことを、同じ入力で突き合わせる。
		vi.setSystemTime(Date.parse('2026-08-01T00:00:00.000Z'));

		const results: Record<string, (string | null)[]> = { W3: [], W4: [] };
		for (const [writer, fire] of [
			['W3', firePaymentFailed],
			['W4', fireSubscriptionPastDue],
		] as const) {
			for (const before of [makeTenant(), makeTenant({ planExpiresAt: EXISTING_EXPIRY })]) {
				mockUpdateTenantStripe.mockClear();
				mockFindTenantById.mockResolvedValue(before);
				mockFindTenantByStripeCustomerId.mockResolvedValue(before);
				await fire();
				results[writer]?.push(resultingColumns(before).planExpiresAt);
			}
		}

		expect(results.W3, 'W3 と W4 の猶予終了日の決め方が食い違っている').toEqual(results.W4);
		// 規則そのものも固定する (両方とも「延ばし続ける」で一致しても駄目)。
		expect(results.W3?.[1], '既存の猶予終了日が書き換わっている').toBe(EXISTING_EXPIRY);
	});

	it('W3 → W4 → W3 と混在して届いても猶予終了日は初回のまま', async () => {
		// Stripe は W3 と W4 を両方送り到着順を保証しない。どの順で何回来ても猶予は延びない。
		vi.setSystemTime(Date.parse('2026-08-01T00:00:00.000Z'));
		const before = makeTenant();
		mockFindTenantById.mockResolvedValue(before);
		mockFindTenantByStripeCustomerId.mockResolvedValue(before);

		await firePaymentFailed();
		const firstExpiry = resultingColumns(before).planExpiresAt;
		expect(firstExpiry, '初回で猶予終了日が立っていない').not.toBeNull();

		// 3 日後に retry が 2 回届く。
		vi.setSystemTime(Date.parse('2026-08-04T00:00:00.000Z'));
		const afterFirst = { ...before, status: 'grace_period', planExpiresAt: firstExpiry };
		mockUpdateTenantStripe.mockClear();
		mockFindTenantById.mockResolvedValue(afterFirst);
		mockFindTenantByStripeCustomerId.mockResolvedValue(afterFirst);
		await fireSubscriptionPastDue();
		await firePaymentFailed();

		expect(resultingColumns(afterFirst).planExpiresAt, '再送で猶予終了日が延びている').toBe(
			firstExpiry,
		);
	});
});

// ---------- AC4: 覆えていない書き手を明示する ----------

describe('#4181 AC4 test で覆えていない書き手を silent gap にしない', () => {
	/**
	 * matrix §5 の書き手 9 箇所のうち、**本 test が直接駆動していないもの**。
	 *
	 * 「全部覆うのが理想だが、覆えないものは覆えていないと明示する」(AC4) に従い、
	 * **理由付きで列挙する**。ここが空配列になったら全件覆えたということ。
	 */
	const UNCOVERED_WRITERS: { id: string; trigger: string; reason: string }[] = [
		{
			id: 'W6',
			trigger: 'アプリ内解約 (tenant/cancel)',
			reason: '契約状態を書かない (#3991)。分類対象の書き込みが無いため対象外',
		},
		{
			id: 'W7',
			trigger: '解約取り消し (tenant/reactivate)',
			reason:
				'W6 と同じく契約状態を書かない (#3991)。Stripe の cancel_at_period_end を false に戻すだけ',
		},
		{
			id: 'W8',
			trigger: '(欠番) 退会猶予満了バッチ',
			reason:
				'書き手なし。退会の物理削除は families 行ごと消すため status を書かない (matrix §4.1)',
		},
		{
			id: 'W9',
			trigger: 'createTenant',
			reason:
				'status=active のみを書く新規作成。webhook 経路ではないため handleWebhookEvent では駆動できない',
		},
	];

	it('覆えていない書き手が理由付きで列挙されている', () => {
		for (const w of UNCOVERED_WRITERS) {
			expect(w.reason.length, `${w.id} の理由が短すぎる (実質空の宣言を許さない)`).toBeGreaterThan(
				20,
			);
		}
		// 覆えたら配列から消す。**消し忘れると「覆っていないのに覆った」と誤読される**ため、
		// 実際に駆動している W1 / W3 / W5 が混ざっていないことを固定する。
		const covered = ['W1', 'W2', 'W3', 'W4', 'W5'];
		for (const id of covered) {
			expect(
				UNCOVERED_WRITERS.map((w) => w.id),
				`${id} は本 test が駆動しているのに未カバー扱いになっています`,
			).not.toContain(id);
		}
	});
});
