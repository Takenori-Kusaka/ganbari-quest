// tests/unit/services/stripe-portal-flow.test.ts
// #4166 — portal session が「顧客がやりたいこと」に直行する。
//
// ## 実害（本番実機、2026-08-01 オーナー操作）
//
// 「⭐⭐ プレミアムへ」を押すと Stripe Customer Portal の**ホーム**に着き、
// 並ぶのは「サブスクリプションを更新」「サブスクリプションをキャンセル」。
// 顧客は「更新 = 支払い方法の更新 / 継続」と読むため**プラン変更に到達しない**。
// オーナー自身が最初に到達できなかった。
//
// **解約側はさらに悪い。** 解約理由フォームを埋めきった直後に portal ホームへ放り出され、
// そこから自分で「サブスクリプションをキャンセル」を探すことになる（特商法の解約導線の実効性）。
//
// ## 何を固定するか
//
// Stripe portal の**ボタン文言は変更できない**（Branding は色・ロゴ・事業者名のみ）。
// したがってアプリ側で `flow_data` を渡し、目的のフローへ直行させるのが唯一の手段。
//
// **CI では着地を検証できない**（flow の描画は Stripe 側、cognito-dev レーンの Stripe は無効 #4161）。
// ユニットで担保できるのは **`create()` に渡した引数**までなので、そこを固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PORTAL_FALLBACK_REASON } from '$lib/domain/constants/stripe-portal';

const mockFindTenantById = vi.fn();
const mockPortalCreate = vi.fn();
// #4548: この経路が**運用から観測できる**ことを固定するために参照を掴んでおく。
const mockWarn = vi.fn();
const mockStripeAlert = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { findTenantById: mockFindTenantById },
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

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => true,
	getStripeClient: () => ({ billingPortal: { sessions: { create: mockPortalCreate } } }),
}));

vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({}),
	planIdFromPriceId: () => null,
	planIdFromLookupKey: () => null,
	getWebhookSecret: () => 'whsec_test',
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));
vi.mock('$lib/server/stripe/alert', () => ({
	notifyStripeAlert: (...args: unknown[]) => mockStripeAlert(...args),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: (...args: unknown[]) => mockWarn(...args), error: vi.fn() },
}));
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyDiscord: vi.fn(),
	notifyIncident: vi.fn(),
}));

import { createPortalSession } from '../../../src/lib/server/services/stripe-service';

const RETURN_URL = 'https://app.example/admin/subscription';

function tenant(overrides: Record<string, unknown> = {}) {
	return {
		tenantId: 't-test',
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: 'sub_123',
		status: 'active',
		plan: 'monthly',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session_1' });
});

/** 直近の create() 引数。 */
function lastArgs(): Record<string, unknown> {
	return mockPortalCreate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe('#4166 AC1 portal は「顧客がやりたいこと」へ直行する', () => {
	it('subscription_update: プラン変更フローへ直行し、対象 subscription を渡す', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind: 'subscription_update' });

		const args = lastArgs();
		expect(args.flow_data, 'flow_data が無いと portal ホームに着く (#4166 の実害そのもの)').toEqual(
			expect.objectContaining({
				type: 'subscription_update',
				subscription_update: { subscription: 'sub_123' },
			}),
		);
	});

	it('subscription_cancel: 解約フローへ直行し、対象 subscription を渡す', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind: 'subscription_cancel' });

		expect(lastArgs().flow_data).toEqual(
			expect.objectContaining({
				type: 'subscription_cancel',
				subscription_cancel: { subscription: 'sub_123' },
			}),
		);
	});

	// AC5: 汎用導線 (請求書確認 / 支払い方法変更) の入口を潰さない
	it('home: flow_data を付けない（汎用導線は portal ホームのまま）', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind: 'home' });

		expect(
			lastArgs().flow_data,
			'汎用導線に flow を付けると請求書・支払い方法の入口が消える',
		).toBeUndefined();
	});

	it('flow 未指定は home 相当（既存呼び出しの挙動を変えない）', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL);

		expect(lastArgs().flow_data).toBeUndefined();
	});
});

describe('#4166 AC3 フロー完了後はアプリへ戻る', () => {
	it.each([
		'subscription_update',
		'subscription_cancel',
	] as const)('%s: after_completion で return_url へ redirect する', async (kind) => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind });

		const flow = lastArgs().flow_data as Record<string, unknown>;
		expect(
			flow.after_completion,
			'省略時の挙動は公式ドキュメントに明記が無く、portal に留まる。明示指定する',
		).toEqual({ type: 'redirect', redirect: { return_url: RETURN_URL } });
	});

	it('途中離脱できるよう、トップレベルの return_url は常に渡す', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind: 'subscription_cancel' });

		expect(lastArgs().return_url).toBe(RETURN_URL);
	});
});

describe('#4270 Stripe が flow を拒否したら home で作り直す', () => {
	// flow は Stripe Dashboard の Portal 設定 (更新オプションの価格 / 解約の許可) が生きている
	// ことを前提にする。設定がずれた瞬間に **portal に一切入れなくなる** のは、直行できないより悪い。
	it.each([
		'subscription_update',
		'subscription_cancel',
	] as const)('%s: 1 回目が失敗しても flow 無しで作り直して URL を返す', async (kind) => {
		mockFindTenantById.mockResolvedValue(tenant());
		mockPortalCreate
			.mockRejectedValueOnce(new Error('No such price / flow not configured'))
			.mockResolvedValueOnce({ url: 'https://billing.stripe.com/home_1' });

		const result = await createPortalSession('t-test', RETURN_URL, { kind });

		expect(mockPortalCreate).toHaveBeenCalledTimes(2);
		expect(
			lastArgs().flow_data,
			'作り直しに flow を残すと同じ理由でまた落ち、portal に入れないままになる',
		).toBeUndefined();
		expect(lastArgs().return_url).toBe(RETURN_URL);
		expect(result).toEqual({
			url: 'https://billing.stripe.com/home_1',
			// #4548: 理由は「Stripe に拒否された」= 再試行で直りうる側。ここを恒久不能と取り違えると、
			// 直りうる顧客に「サポートへ連絡してください」を出して自力解決を奪う。
			flowFallback: PORTAL_FALLBACK_REASON.FLOW_REJECTED,
		});
	});

	it('倒れたことを呼び出し元に伝える (黙って portal ホームへ落とさないため)', async () => {
		mockFindTenantById.mockResolvedValue(tenant());
		mockPortalCreate
			.mockRejectedValueOnce(new Error('flow rejected'))
			.mockResolvedValueOnce({ url: 'https://billing.stripe.com/home_2' });

		const result = await createPortalSession('t-test', RETURN_URL, {
			kind: 'subscription_cancel',
		});

		expect(
			'flowFallback' in result && result.flowFallback,
			'立てないと画面が「予期しない場所に着いた」ことに気づけず案内を出せない',
		).toBe(PORTAL_FALLBACK_REASON.FLOW_REJECTED);
	});

	it('成功したときは flowFallback を立てない (通常の直行と区別する)', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		const result = await createPortalSession('t-test', RETURN_URL, {
			kind: 'subscription_update',
		});

		expect(result).toEqual({ url: 'https://billing.stripe.com/session_1' });
	});

	// #4329: 「portal に入れない事実を成功として返さない」という不変条件は維持したまま、
	// 伝え方を throw から**型付きの失敗**に変えた。throw は呼び出し元 (解約 action) で
	// catch されず 500 エラーページになり、解約理由を書き終えた顧客に**何も伝わらない**まま
	// 導線が切れていた。型付きの失敗なら呼び出し元は握り潰せず (union 分岐が必要)、
	// 顧客への案内と運用側 alert を出せる。
	it('作り直しも失敗したら成功として返さない (型付きの失敗で呼び出し元に伝える)', async () => {
		mockFindTenantById.mockResolvedValue(tenant());
		mockPortalCreate.mockRejectedValue(new Error('Stripe API down'));

		const result = await createPortalSession('t-test', RETURN_URL, {
			kind: 'subscription_update',
		});

		expect('url' in result, 'portal に入れないのに URL を返すと導線が黙って死ぬ').toBe(false);
		expect(result).toEqual({ error: 'PORTAL_CREATE_FAILED' });
	});
});

describe('#4166 AC2 subscription を持たないなら home にフォールバックする', () => {
	// flow を付けたまま subscription なしで投げると Stripe が 400 を返し、
	// **導線ごと死ぬ**（顧客は何を押しても portal に入れない）。
	it.each([
		'subscription_update',
		'subscription_cancel',
	] as const)('%s: stripeSubscriptionId が無ければ flow を付けない', async (kind) => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null }));

		const result = await createPortalSession('t-test', RETURN_URL, { kind });

		expect(
			lastArgs().flow_data,
			'subscription 無しで flow を付けると Stripe が 400 を返し導線ごと死ぬ',
		).toBeUndefined();
		// **落とさずに portal へは入れる**こと（fallback の意味）。
		// #4537: 同時に「直行できていない」を呼び出し元へ伝える (下の describe が固定する)。
		expect(result).toEqual({
			url: 'https://billing.stripe.com/session_1',
			flowFallback: PORTAL_FALLBACK_REASON.NO_SUBSCRIPTION,
		});
	});
});

describe('#4537 subscription が無くて flow を組めなかったことを黙って通さない', () => {
	// ## 実害
	//
	// `stripeCustomerId` はあるが `stripeSubscriptionId` が null の顧客は、flow_data 無しで
	// session を作るので Stripe API は**成功する**。旧実装は `{ url }` だけを返し、呼び出し元は
	// 「直行できた」と解釈して素通ししていた。顧客は「解約手続きへ進む」を押したのに
	// portal ホームへ放り出され、**説明が一切出ない**。
	//
	// DB の stripeSubscriptionId が null なのに Stripe 側にサブスクが生きているドリフトがあれば、
	// これは「押したのに課金が続く」(#4498) と同じ結果になる。
	it.each([
		'subscription_update',
		'subscription_cancel',
	] as const)('%s: subscription が無ければ flowFallback を立てる', async (kind) => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null }));

		const result = await createPortalSession('t-test', RETURN_URL, { kind });

		// #4548: 理由まで固定する。ここが FLOW_REJECTED になると画面は「もう一度お試しください」を
		// 出し、**何度押しても同じ結果になる**顧客が出口の無いループに入る (特商法上の実効性)。
		expect(
			'flowFallback' in result && result.flowFallback,
			'立てないと呼び出し元は素通しし、顧客は説明なく portal ホームへ落ちる',
		).toBe(PORTAL_FALLBACK_REASON.NO_SUBSCRIPTION);
	});

	it('undefined の subscription (列自体が無い) でも flowFallback を立てる', async () => {
		// `?? null` の正規化を経由しない実データ形状でも判定が効くこと
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: undefined }));

		const result = await createPortalSession('t-test', RETURN_URL, {
			kind: 'subscription_cancel',
		});

		expect('flowFallback' in result && result.flowFallback).toBe(
			PORTAL_FALLBACK_REASON.NO_SUBSCRIPTION,
		);
	});

	it('空文字の subscription でも flowFallback を立てる (flow_data を組めていない事実は同じ)', async () => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: '' }));

		const result = await createPortalSession('t-test', RETURN_URL, {
			kind: 'subscription_cancel',
		});

		expect(lastArgs().flow_data).toBeUndefined();
		expect('flowFallback' in result && result.flowFallback).toBe(
			PORTAL_FALLBACK_REASON.NO_SUBSCRIPTION,
		);
	});

	// AC2: home は「ホームに着く」のが期待どおりの着地。ここまで案内を出すと、請求書確認 /
	// 支払い方法変更をしに来た顧客に「手続きは完了していません」が出てしまう。
	it('home 要求時は subscription が無くても flowFallback を立てない', async () => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null }));

		const result = await createPortalSession('t-test', RETURN_URL, { kind: 'home' });

		expect(result).toEqual({ url: 'https://billing.stripe.com/session_1' });
	});

	it('flow 未指定 (home 相当) も同様に立てない', async () => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null }));

		const result = await createPortalSession('t-test', RETURN_URL);

		expect(result).toEqual({ url: 'https://billing.stripe.com/session_1' });
	});

	it('subscription があって直行できたときは立てない (通常経路の回帰防止)', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		const result = await createPortalSession('t-test', RETURN_URL, {
			kind: 'subscription_cancel',
		});

		expect(result).toEqual({ url: 'https://billing.stripe.com/session_1' });
	});

	it('subscription 無しで session 作成も失敗したら成功として返さない', async () => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null }));
		mockPortalCreate.mockRejectedValue(new Error('Stripe API down'));

		const result = await createPortalSession('t-test', RETURN_URL, {
			kind: 'subscription_cancel',
		});

		expect(result).toEqual({ error: 'PORTAL_CREATE_FAILED' });
	});
});

describe('#4548 subscription 不在のドリフトを運用から観測できるようにする', () => {
	// ## なぜ必要か
	//
	// 「DB は stripeSubscriptionId が null だが Stripe 側ではサブスクが生きている」ドリフトでは、
	// 顧客は解約フローに到達できないまま課金され続ける。#4270 の flow 拒否経路は logger.warn を
	// 残していたのに、この経路は logger も alert も呼んでおらず、**何件起きているか誰にも
	// 分からなかった**。件数が見えなければ、行き止まりに嵌まった顧客の存在に運用が気づけない。
	it('subscription 不在で home に着地したことを tenantId 付きで記録する', async () => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null }));

		await createPortalSession('t-test', RETURN_URL, { kind: 'subscription_cancel' });

		expect(
			mockWarn,
			'記録が無いと、解約できない顧客が何人いるか運用側から永久に見えない',
		).toHaveBeenCalledTimes(1);
		const message = String(mockWarn.mock.calls.at(0)?.[0] ?? '');
		expect(message, 'どのテナントかを特定できないと個別救済ができない').toContain('t-test');
		expect(message).toContain('subscription');
	});

	// Pre-PMF (ADR-0010): 「解約済みで Customer だけ残る顧客の再訪」でも立つシグナルなので、
	// alert にすると通知が鳴り続けて誰も読まなくなる。件数は logger を数えて把握する。
	it('Discord alert は上げない (正常な再訪でも立つため alert fatigue になる)', async () => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null }));

		await createPortalSession('t-test', RETURN_URL, { kind: 'subscription_cancel' });

		expect(mockStripeAlert).not.toHaveBeenCalled();
	});

	it('home 要求時は記録しない (期待どおりの着地でログを埋めない)', async () => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null }));

		await createPortalSession('t-test', RETURN_URL, { kind: 'home' });

		expect(mockWarn).not.toHaveBeenCalled();
	});
});
