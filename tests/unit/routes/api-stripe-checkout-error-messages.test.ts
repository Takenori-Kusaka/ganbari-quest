// tests/unit/routes/api-stripe-checkout-error-messages.test.ts
// #4286: POST /api/stripe/checkout の messageMap で STRIPE_DISABLED と PRICE_UNRESOLVED が
// 同一文言（「決済機能は現在利用できません」）だったため、顧客が「設定不備」か「機能停止」かを
// 区別できず、再試行導線も無いまま離脱していた問題の回帰防止。
//
// 固定する不変条件:
//   1. PRICE_UNRESOLVED と STRIPE_DISABLED は異なる文言を返す
//   2. PRICE_UNRESOLVED の文言は SUBSCRIPTION_PAGE_LABELS.checkoutErrorPriceUnresolved
//      (labels.ts SSOT) と一致する（ハードコード禁止、DESIGN.md §6）
//   3. PRICE_UNRESOLVED の文言に price ID 等の内部詳細を含まない（ADR-0062、内部例外非露出）
//   4. 両者とも status は 503（配備の設定不備であって顧客の入力誤りではない）

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUBSCRIPTION_PAGE_LABELS } from '../../../src/lib/domain/labels';

const mockCreateCheckoutSession = vi.fn();

vi.mock('$lib/server/services/stripe-service', () => ({
	createCheckoutSession: (...args: unknown[]) => mockCreateCheckoutSession(...args),
}));

import { POST } from '../../../src/routes/api/stripe/checkout/+server';

function makeRequestEvent(errorCode: string) {
	mockCreateCheckoutSession.mockResolvedValue({ error: errorCode });

	const request = new Request('http://localhost/api/stripe/checkout', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ planId: 'monthly' }),
	});

	return {
		request,
		url: new URL('http://localhost/api/stripe/checkout'),
		locals: {
			context: { role: 'owner', tenantId: 't-test' },
		},
	} as Parameters<typeof POST>[0];
}

/** POST が `error()` (SvelteKit HttpError) を throw する前提で、その中身を取り出す */
async function catchHttpError(
	errorCode: string,
): Promise<{ status: number; body: { message: string } }> {
	try {
		await POST(makeRequestEvent(errorCode));
	} catch (e) {
		return e as { status: number; body: { message: string } };
	}
	throw new Error(`POST が例外を throw しなかった (errorCode=${errorCode})`);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/stripe/checkout エラー文言 (#4286)', () => {
	it('PRICE_UNRESOLVED は STRIPE_DISABLED と異なる文言を返す', async () => {
		const priceUnresolved = await catchHttpError('PRICE_UNRESOLVED');
		const stripeDisabled = await catchHttpError('STRIPE_DISABLED');

		expect(priceUnresolved.body.message).not.toBe(stripeDisabled.body.message);
	});

	it('PRICE_UNRESOLVED は labels.ts SSOT (SUBSCRIPTION_PAGE_LABELS.checkoutErrorPriceUnresolved) の文言を 503 で返す', async () => {
		const thrown = await catchHttpError('PRICE_UNRESOLVED');

		expect(thrown.status).toBe(503);
		expect(thrown.body.message).toBe(SUBSCRIPTION_PAGE_LABELS.checkoutErrorPriceUnresolved);
	});

	it('PRICE_UNRESOLVED の文言は内部詳細 (price ID 等) を含まない (ADR-0062)', async () => {
		const thrown = await catchHttpError('PRICE_UNRESOLVED');

		expect(thrown.body.message).not.toMatch(/price[_ ]?id/i);
	});

	it('STRIPE_DISABLED の文言・status は既存のまま変化しない (回帰防止)', async () => {
		const thrown = await catchHttpError('STRIPE_DISABLED');

		expect(thrown.status).toBe(503);
		expect(thrown.body.message).toBe('決済機能は現在利用できません');
	});
});

// ============================================================
// #4329 ② — 「原因の所在を偽らない」
//
// #4286 では lookup_key の dead wiring (配備の設定不備) が原因なのに、顧客には
// 「プランが正しくありません」= **あなたのプラン選択が悪い** と読める文言が 400 で出ていた。
// 原因の所在を偽ると、顧客は直しようのない操作を繰り返す。#4299 が根本原因を直したが
// 文言はそのまま残っていた。
// ============================================================

describe('POST /api/stripe/checkout 顧客向け文言の SSOT と責任の所在 (#4329)', () => {
	const CUSTOMER_FACING_CODES = [
		'STRIPE_DISABLED',
		'TENANT_NOT_FOUND',
		'ALREADY_SUBSCRIBED',
		'INVALID_PLAN',
		'PRICE_UNRESOLVED',
	];

	it('AC5: すべての顧客向け文言が labels.ts SSOT の値である (直書き禁止、DESIGN.md §6)', async () => {
		const ssotValues = Object.values(SUBSCRIPTION_PAGE_LABELS).filter(
			(v): v is string => typeof v === 'string',
		);

		for (const code of CUSTOMER_FACING_CODES) {
			const thrown = await catchHttpError(code);
			expect(ssotValues, `${code} の文言が labels.ts に存在しない`).toContain(
				thrown.body.message,
			);
		}
	});

	it('AC6: サーバー側の異常 (INVALID_PLAN) を顧客の入力ミスとして表示しない', async () => {
		const thrown = await catchHttpError('INVALID_PLAN');

		// 「プランが正しくありません」= 顧客の選択を責める文言。planId は route の
		// 許可リストを通過済なので、ここに来る INVALID_PLAN は配備の設定不備である。
		expect(thrown.body.message).not.toContain('プランが正しくありません');
		expect(thrown.status).not.toBe(400);
		expect(thrown.status).toBeGreaterThanOrEqual(500);
	});

	it('AC6: 認証済 tenant の不在も顧客の状態の説明にしない (4xx にしない)', async () => {
		const thrown = await catchHttpError('TENANT_NOT_FOUND');

		expect(thrown.body.message).not.toContain('アカウントが見つかりません');
		expect(thrown.status).toBeGreaterThanOrEqual(500);
	});

	it('AC6: 顧客の状態そのものである ALREADY_SUBSCRIBED は 409 のまま説明する (過剰一般化しない)', async () => {
		const thrown = await catchHttpError('ALREADY_SUBSCRIBED');

		expect(thrown.status).toBe(409);
		expect(thrown.body.message).toBe(SUBSCRIPTION_PAGE_LABELS.checkoutErrorAlreadySubscribed);
	});

	it('内部詳細 (エラーコード / 例外文言) を顧客向け文言に露出しない (ADR-0062)', async () => {
		for (const code of CUSTOMER_FACING_CODES) {
			const thrown = await catchHttpError(code);
			expect(thrown.body.message).not.toContain(code);
			expect(thrown.body.message).not.toMatch(/stripe|error|price[_ ]?id/i);
		}
	});
});
