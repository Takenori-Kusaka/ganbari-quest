// tests/unit/architecture/contract-transition-matrix-ssot.test.ts
// EPIC #4118 完了の定義 —「状態遷移表が 1 枚存在し、**そこに書かれた遷移だけが実装で起こる**ことが
// 機械検証されている」の後半を担う。
//
// ## 既存の装置との境界
//
// - `contract-state-matrix-ssot.test.ts` (#4181) は matrix §4 の **状態 (S* / X*) の集合**を照合する
// - `stripe-contract-state-classification.test.ts` (#4181) は handler の**書き込み後が S1〜S6 に入る**ことを見る
// - **本 file は「どの状態からどの状態へ」= 遷移そのもの**を、matrix §5 の `遷移` 列と突き合わせる
//
// 状態の集合が合っていても、遷移は別物である。`invoice.paid` が S4 (停止) から S2 (課金中) へ
// 戻せることは、どちらの状態も表にある以上、上の 2 つでは検出できない。
// 表を読んだ運用者は「S4 から復帰する経路は無い」と誤解したまま障害対応することになる。
//
// ## どうやって遷移を機械的に取るか（方式と、その限界）
//
// **方式: handler を実際に呼び、書き込み前後の 4 列を `classifyContractState()` で分類して観測する。**
//
// 静的解析は採らない。`updateTenantStripe` は差分 patch (`undefined` = 更新しない) を受けるため、
// 書き込み後の行は「更新前の行 + patch」でしか決まらない。patch の字面から遷移先を導くと
// 「静的に読むと正しく見えるが効果が違う」形になる (matrix §7 で gate スクリプトを退けた理由と同じ)。
//
// 観測は **入力領域を総当たり**する: 5 つの開始状態 (S1〜S5) × Stripe subscription status 8 種 ×
// webhook 4 種 + checkout。「fixture を書いた遷移しか見えない」を避けるため、fixture は
// 状態と status の直積から機械生成し、**書き込みが起きた組み合わせだけ**を遷移として記録する。
//
// **この方式で検出できること**:
//   (a) 表に書いた遷移が実装で起こらない (表が実装より強い / 実装が壊れた)
//   (b) 実装が表に無い遷移を起こす (表が実装に追いついていない)
//
// **この方式で検出できないこと** (silent に落とさないため明記する):
//   - 状態クラスが同じで**列の値だけが違う**書き込み (例: 猶予終了日を延長するか据え置くか)。
//     S3 → S3 としか見えない。列の値は `stripe-contract-state-classification.test.ts` 側の責務
//   - 本 file が駆動しない書き手 (下の `UNDRIVEN_WRITERS`) と、開始状態 S6 (§4.1 legacy 行)
//   - `metadata.planId` が未知の checkout (matrix §4 X2「起きうる」)。plan 解決の失敗であって
//     状態遷移ではないため、駆動する入力領域から外す (X2 は alert で観測する)
//
// 装置 ratchet (チーム憲章 #4175 §4.5) に従い **新規 script は作らず** `tests/unit/architecture/` に置く。

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// ---------- Mocks (stripe-contract-state-classification.test.ts と同型) ----------

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

const mockSubscriptionsRetrieve = vi.fn();
vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => true,
	getStripeClient: () => ({ subscriptions: { retrieve: mockSubscriptionsRetrieve } }),
}));

vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({
		monthly: { priceId: 'price_monthly_123', amount: 500, interval: 'month', label: '月額' },
	}),
	planIdFromPriceId: (priceId: string) => (priceId === 'price_monthly_123' ? 'monthly' : null),
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
	type ContractStateColumns,
	classifyContractState,
	VALID_CONTRACT_STATES,
} from '$lib/domain/contract-state';
import { handleWebhookEvent } from '../../../src/lib/server/services/stripe-service';

const MATRIX = 'docs/design/billing-redesign/contract-state-matrix.md';

// ============================================================
// 1. 表 (§5 `遷移` 列) を読む
// ============================================================

/** `W2` などの書き手 id → その行が宣言する遷移集合 (`"S3→S2"`)。 */
type DeclaredTransitions = Map<string, Set<string>>;

/**
 * §5 の表から `| W<n> | … | <遷移> |` を読み、遷移を集合に落とす。
 *
 * 受け付ける書式は 2 つだけ:
 *   - `S2 → S3` / `S2/S3/S4 → S5` (左辺は `/` 区切りで複数可)
 *   - `S2 ⇄ S3` (両向き)
 *
 * 左辺を省いた `→ S4` のような書き方は **採らない**。前の項から主語を引き継ぐ読み方は
 * 人によって解釈が割れ、機械照合の基準にならない。
 */
function parseMatrixTransitions(): DeclaredTransitions {
	const md = readFileSync(MATRIX, 'utf8');
	const declared: DeclaredTransitions = new Map();

	for (const line of md.split('\n')) {
		const row = /^\|\s*(W\d+)\s*\|(.*)\|\s*$/.exec(line);
		if (!row?.[1] || row[2] === undefined) continue;
		const cells = row[2].split('|');
		const transitionCell = cells[cells.length - 1] ?? '';

		const set = new Set<string>();
		const term = /(S\d(?:\s*\/\s*S\d)*)\s*(→|⇄)\s*(S\d)/g;
		let m: RegExpExecArray | null = term.exec(transitionCell);
		while (m !== null) {
			const sources = (m[1] as string).split('/').map((s) => s.trim());
			const arrow = m[2] as string;
			const target = m[3] as string;
			for (const from of sources) {
				set.add(`${from}→${target}`);
				if (arrow === '⇄') set.add(`${target}→${from}`);
			}
			m = term.exec(transitionCell);
		}
		declared.set(row[1], set);
	}
	return declared;
}

// ============================================================
// 2. 実装を駆動して遷移を観測する
// ============================================================

const SUB = 'sub_current';
const CUSTOMER = 'cus_123';
const PRICE = 'price_monthly_123';

/** Stripe subscription.status の全域 (SDK の union)。終端 2 値を含める。 */
const STRIPE_STATUSES = [
	'active',
	'trialing',
	'past_due',
	'unpaid',
	'paused',
	'incomplete',
	'canceled',
	'incomplete_expired',
] as const;

/** 開始状態 (matrix §4)。S6 は §4.1 のとおり legacy 行のみのため駆動しない。 */
const START_STATES: Record<string, Record<string, unknown>> = {
	S1: { status: 'active', plan: null, stripeSubscriptionId: null, planExpiresAt: null },
	S2: { status: 'active', plan: 'monthly', stripeSubscriptionId: SUB, planExpiresAt: null },
	S3: {
		status: 'grace_period',
		plan: 'monthly',
		stripeSubscriptionId: SUB,
		planExpiresAt: '2026-09-01T00:00:00.000Z',
	},
	S4: { status: 'suspended', plan: 'monthly', stripeSubscriptionId: SUB, planExpiresAt: null },
	S5: { status: 'suspended', plan: null, stripeSubscriptionId: null, planExpiresAt: null },
};

function makeTenant(state: string): Record<string, unknown> {
	return {
		tenantId: 't-test',
		name: 'テスト家族',
		ownerId: 'u-owner',
		stripeCustomerId: CUSTOMER,
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...START_STATES[state],
	};
}

/** 「更新前の行 + patch」。`undefined` は「更新しない」なので上書きしない。 */
function mergePatch(
	before: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const merged = { ...before };
	for (const [k, v] of Object.entries(patch)) {
		if (v !== undefined) merged[k] = v;
	}
	return merged;
}

function toColumns(row: Record<string, unknown>): ContractStateColumns {
	return {
		status: String(row.status),
		plan: (row.plan ?? null) as string | null,
		stripeSubscriptionId: (row.stripeSubscriptionId ?? null) as string | null,
		planExpiresAt: (row.planExpiresAt ?? null) as string | null,
	};
}

/** subscription payload / retrieve 応答。 */
function subscription(status: string): Record<string, unknown> {
	return {
		id: SUB,
		customer: CUSTOMER,
		status,
		metadata: { tenantId: 't-test' },
		items: { data: [{ price: { id: PRICE } }] },
	};
}

function eventFor(writer: string, stripeStatus: string): Record<string, unknown> {
	switch (writer) {
		case 'W1':
			return {
				type: 'checkout.session.completed',
				data: {
					object: {
						id: 'cs_test',
						metadata: { tenantId: 't-test', planId: 'monthly' },
						customer: CUSTOMER,
						subscription: SUB,
						customer_details: { email: 'test@example.com' },
						customer_email: null,
					},
				},
			};
		case 'W2':
			return {
				type: 'invoice.paid',
				data: {
					object: {
						id: 'in_paid',
						customer: CUSTOMER,
						parent: { subscription_details: { subscription: SUB } },
					},
				},
			};
		case 'W3':
			return {
				type: 'invoice.payment_failed',
				data: {
					object: {
						id: 'in_failed',
						customer: CUSTOMER,
						parent: { subscription_details: { subscription: SUB } },
					},
				},
			};
		case 'W4':
			return {
				type: 'customer.subscription.updated',
				data: { object: subscription(stripeStatus) },
			};
		case 'W5':
			return {
				type: 'customer.subscription.deleted',
				data: { object: subscription(stripeStatus) },
			};
		default:
			throw new Error(`driven writer ではありません: ${writer}`);
	}
}

/**
 * 1 組み合わせを駆動し、書き込みが起きたなら遷移を返す。
 *
 * 書き込みが起きなかった (突合で skip / 終端で早期 return) 場合は `null`。
 * **「書かなかった」は遷移ではない**ので観測集合に入れない。
 */
async function observe(
	writer: string,
	startState: string,
	stripeStatus: string,
): Promise<string | null> {
	vi.clearAllMocks();
	const before = makeTenant(startState);
	mockFindTenantById.mockResolvedValue(before);
	mockFindTenantByStripeCustomerId.mockResolvedValue(before);
	mockSubscriptionsRetrieve.mockResolvedValue(subscription(stripeStatus));

	await handleWebhookEvent(eventFor(writer, stripeStatus) as never);

	if (mockUpdateTenantStripe.mock.calls.length === 0) return null;

	let row = before;
	for (const call of mockUpdateTenantStripe.mock.calls) {
		row = mergePatch(row, call[1] as Record<string, unknown>);
	}
	const from = classifyContractState(toColumns(before));
	const to = classifyContractState(toColumns(row));
	return `${from}→${to}`;
}

/**
 * 駆動する書き手と、その入力領域。
 *
 * W1 (checkout) の開始状態を S1 / S5 に絞るのは、`createCheckoutSession()` が
 * `if (tenant.stripeSubscriptionId) return { error: 'ALREADY_SUBSCRIBED' }` で
 * **sub を持つテナントの checkout session 生成そのものを拒む**ため。
 * sub ありから始まる checkout.session.completed は生成経路が無い。
 */
const DRIVEN: { writer: string; startStates: string[]; stripeStatuses: readonly string[] }[] = [
	{ writer: 'W1', startStates: ['S1', 'S5'], stripeStatuses: ['active'] },
	{ writer: 'W2', startStates: ['S1', 'S2', 'S3', 'S4', 'S5'], stripeStatuses: STRIPE_STATUSES },
	{ writer: 'W3', startStates: ['S1', 'S2', 'S3', 'S4', 'S5'], stripeStatuses: STRIPE_STATUSES },
	{ writer: 'W4', startStates: ['S1', 'S2', 'S3', 'S4', 'S5'], stripeStatuses: STRIPE_STATUSES },
	{ writer: 'W5', startStates: ['S1', 'S2', 'S3', 'S4', 'S5'], stripeStatuses: STRIPE_STATUSES },
];

/**
 * 駆動しない書き手。**空にできないなら理由を書く** (#4181 AC4 と同じ扱い)。
 *
 * ここに挙がっている限り「実装にあって表に無い遷移」は検出されない。
 */
const UNDRIVEN_WRITERS: { id: string; reason: string }[] = [
	{
		id: 'W6',
		reason:
			'アプリ内解約。契約状態を書かない (#3991、Stripe の cancel_at_period_end が SSOT)。書き込みが無い = 遷移が無いことは stripe-contract-write-single-enforcement.test.ts が構造で保証する',
	},
	{
		id: 'W7',
		reason:
			'解約取り消し。W6 と同じく契約状態を書かない (#3991)。Stripe の cancel_at_period_end を false に戻すだけ',
	},
	{
		id: 'W8',
		reason:
			'欠番。退会の物理削除は families 行ごと消すため status を書かない (matrix §4.1)。書き手が存在しない',
	},
	{
		id: 'W9',
		reason:
			'createTenant。行を新規作成して S1 を作るため開始状態が存在せず、遷移として表現できない。webhook 経路でもないため handleWebhookEvent では駆動できない',
	},
];

/** 駆動対象の全組み合わせを回し、書き手ごとの観測遷移集合を返す。 */
async function observeAllTransitions(): Promise<Map<string, Set<string>>> {
	const observed = new Map<string, Set<string>>();
	for (const { writer, startStates, stripeStatuses } of DRIVEN) {
		const set = new Set<string>();
		for (const startState of startStates) {
			// 開始状態の前提が崩れていたら、以降の観測は意味が無い
			expect(
				classifyContractState(toColumns(makeTenant(startState))),
				`開始状態 fixture が ${startState} に分類されません`,
			).toBe(startState);

			for (const stripeStatus of stripeStatuses) {
				const transition = await observe(writer, startState, stripeStatus);
				if (transition) set.add(transition);
			}
		}
		observed.set(writer, set);
	}
	return observed;
}

/**
 * 観測した遷移の両端が正常状態 (S*) であることを確かめる。
 *
 * 遷移先が S* に収まること自体は #4181 AC3 の責務だが、X* / UNCLASSIFIED を
 * 「表に無い遷移」として報告すると是正の当て先を誤るのでここでも切り分ける。
 */
function expectAllStatesValid(writer: string, transitions: Set<string>): void {
	for (const transition of transitions) {
		for (const state of transition.split('→')) {
			expect(
				(VALID_CONTRACT_STATES as readonly string[]).includes(state),
				`${writer} が ${transition} を起こした (${state} は正常状態ではない)`,
			).toBe(true);
		}
	}
}

// ============================================================
// 3. 照合
// ============================================================

describe('#4118 完了の定義 — 表に書かれた遷移だけが実装で起こる', () => {
	const declared = parseMatrixTransitions();

	it('§5 の書き手 9 行すべてを読めている', () => {
		// 母数が欠けると「一致している」ではなく「検査できていない」。表の書式が変わって
		// 行を拾えなくなったとき、緑で素通りさせない (#4084 と同じ形)。
		expect([...declared.keys()].sort(), `${MATRIX} §5 の書き手行を読めていません`).toEqual([
			'W1',
			'W2',
			'W3',
			'W4',
			'W5',
			'W6',
			'W7',
			'W8',
			'W9',
		]);
	});

	it('駆動する書き手は表に遷移が宣言されている', () => {
		for (const { writer } of DRIVEN) {
			expect(
				declared.get(writer)?.size ?? 0,
				`${writer} の遷移が ${MATRIX} §5 から 1 件も読めていません。` +
					'書式は `S2 → S3` / `S2/S3/S4 → S5` / `S2 ⇄ S3` のいずれかです',
			).toBeGreaterThan(0);
		}
	});

	it('駆動しない書き手には遷移が宣言されていない', () => {
		// 書き込まない書き手に遷移を書くと、表を読んだ人が「DB が動く」と誤解する。
		for (const { id } of UNDRIVEN_WRITERS) {
			expect(
				[...(declared.get(id) ?? [])],
				`${id} は契約状態を書かないのに ${MATRIX} §5 が遷移を宣言しています`,
			).toEqual([]);
		}
	});

	it('観測した遷移と表の宣言が双方向で一致する', async () => {
		const observed = await observeAllTransitions();

		for (const [writer, set] of observed) {
			// 観測が空なら「一致」ではなく「駆動できていない」
			expect(set.size, `${writer} を駆動したが書き込みが 1 度も起きていません`).toBeGreaterThan(0);
			expectAllStatesValid(writer, set);

			expect(
				[...set].sort(),
				`${writer} の遷移が ${MATRIX} §5 の宣言と食い違っています。\n` +
					'  実装にあって表に無い → 表に足す (その遷移が正しいかを先に判断する)\n' +
					'  表にあって実装に無い → 実装が壊れたか、表が実装より強い',
			).toEqual([...(declared.get(writer) ?? [])].sort());
		}
	});

	it('駆動できない書き手が理由付きで列挙されている', () => {
		for (const w of UNDRIVEN_WRITERS) {
			expect(w.reason.length, `${w.id} の理由が短すぎる (実質空の宣言を許さない)`).toBeGreaterThan(
				20,
			);
		}
		const drivenIds = DRIVEN.map((d) => d.writer);
		for (const w of UNDRIVEN_WRITERS) {
			expect(drivenIds, `${w.id} は駆動しているのに未駆動扱いになっています`).not.toContain(w.id);
		}
	});
});
