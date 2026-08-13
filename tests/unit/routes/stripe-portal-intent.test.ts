// tests/unit/routes/stripe-portal-intent.test.ts
// #4166 / #4270 — POST /api/stripe/portal が「顧客の意図」をどう扱うか。
//
// `intent` はブラウザから来る文字列で、いまは portal の着地 (flow) の出し分けにしか使っていない。
// 無検証のまま通す形が残っていると、後で認可判定に使う変更が入ったときに同じ書き方が踏襲される。
// **許容値の allowlist で検証し、外れたら安全側 (home) に倒す**ことを固定する (#4270 決裁 3)。
//
// あわせて #4270 決裁 1 の fallback（Stripe が flow を拒否 → home で作り直し）が
// クライアントまで伝わることを固定する。伝わらないと、顧客は「プラン変更画面に行くはずが
// 違う画面に着いた」だけを持ち帰る。
//
// cspell:ignore upgradeee
//   `plan-upgradeee` は「許容値で始まるが許容値ではない」負例。綴りを直すと
//   prefix 一致の緩い判定 (#3956 で実害) を検出できなくなるため、この file scope で許可する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PORTAL_FALLBACK_REASON } from '$lib/domain/constants/stripe-portal';

const mockCreatePortalSession = vi.fn();
const mockIsPinConfigured = vi.fn();
const mockWarn = vi.fn();

vi.mock('$lib/server/services/stripe-service', () => ({
	createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
}));

vi.mock('$lib/server/services/auth-service', () => ({
	isPinConfigured: (...args: unknown[]) => mockIsPinConfigured(...args),
	verifyPin: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: (...args: unknown[]) => mockWarn(...args), error: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/stripe/portal/+server');

/** PIN 未設定テナント想定。確認フレーズ経路で PIN 入力を迂回する (本 test の関心は intent)。 */
const CONFIRM_PHRASE = 'プランを変更します';

function callPortal(body: Record<string, unknown>) {
	return (
		POST as unknown as (event: {
			locals: unknown;
			url: URL;
			request: { json: () => Promise<unknown> };
		}) => Promise<Response>
	)({
		locals: { context: { tenantId: 't-test', role: 'owner' } },
		url: new URL('https://app.example/api/stripe/portal'),
		request: { json: async () => body },
	});
}

/** 直近の createPortalSession に渡された flow。 */
function lastFlow(): { kind: string } {
	return mockCreatePortalSession.mock.calls.at(-1)?.[2] as { kind: string };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockIsPinConfigured.mockResolvedValue(false);
	mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session_1' });
});

describe('#4270 intent は allowlist で検証する', () => {
	it('plan-upgrade: プラン変更フローへ直行させる', async () => {
		await callPortal({ confirmPhrase: CONFIRM_PHRASE, intent: 'plan-upgrade' });

		expect(lastFlow()).toEqual({ kind: 'subscription_update' });
	});

	it.each([
		'plan-change',
		'billing-history',
	])('%s: home のまま (請求書の入口を潰さない)', async (intent) => {
		await callPortal({ confirmPhrase: CONFIRM_PHRASE, intent });

		expect(lastFlow()).toEqual({ kind: 'home' });
	});

	it.each([
		['許容外の文字列', 'plan-upgrade-x'],
		['prefix 一致でしかない値', 'plan-upgradeee'],
		['空文字', ''],
		['型が違う値', 42],
	])('%s は拒否して home に倒し、拒否した事実を記録する', async (_name, intent) => {
		await callPortal({ confirmPhrase: CONFIRM_PHRASE, intent });

		expect(lastFlow(), '許容外の値で flow を出し分けない').toEqual({ kind: 'home' });
		expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('portal intent を拒否'));
	});

	it('拒否ログに顧客識別子を載せない (#4174 / #4197 と同基準)', async () => {
		await callPortal({ confirmPhrase: CONFIRM_PHRASE, intent: 'unknown-intent' });

		const logged = String(mockWarn.mock.calls.at(-1)?.[0] ?? '');
		expect(logged).not.toContain('t-test');
	});

	it('intent 未指定は既定 (home) で、拒否ログを出さない (既存呼び出しを騒がせない)', async () => {
		await callPortal({ confirmPhrase: CONFIRM_PHRASE });

		expect(lastFlow()).toEqual({ kind: 'home' });
		expect(mockWarn).not.toHaveBeenCalled();
	});
});

describe('#4270 flow が home に倒れたことをクライアントへ返す', () => {
	// #4548: 理由も返す。画面は理由で「もう一度」と「サポートへ連絡」を出し分けるため、
	// ここで理由を落とすと恒久不能の顧客に再試行を促し続ける行き止まりが復活する。
	it.each([
		[PORTAL_FALLBACK_REASON.FLOW_REJECTED],
		[PORTAL_FALLBACK_REASON.NO_SUBSCRIPTION],
	])('flowFallback=%s を理由つきでそのまま返す (画面が次の操作を出し分けられる)', async (reason) => {
		mockCreatePortalSession.mockResolvedValue({
			url: 'https://billing.stripe.com/home_1',
			flowFallback: reason,
		});

		const res = await callPortal({ confirmPhrase: CONFIRM_PHRASE, intent: 'plan-upgrade' });

		expect(await res.json()).toEqual({
			url: 'https://billing.stripe.com/home_1',
			flowFallback: true,
			flowFallbackReason: reason,
		});
	});

	it('直行できたときは flowFallback=false (案内を出さない)', async () => {
		const res = await callPortal({ confirmPhrase: CONFIRM_PHRASE, intent: 'plan-upgrade' });

		expect(await res.json()).toEqual({
			url: 'https://billing.stripe.com/session_1',
			flowFallback: false,
			flowFallbackReason: null,
		});
	});
});
