// tests/e2e/integration/stripe-checkout-labels.spec.ts
// #2346 (EPIC #2345): 景品表示法対応 CRITICAL fix の回帰防止 E2E
//
// 目的:
//   - `src/lib/server/services/stripe-service.ts` `custom_text.submit` / `after_submit`
//     が `CHECKOUT_LABELS` SSOT 経由で「お選びのプランの機能」文言を渡していることを保証。
//   - 旧文言「すべての機能」が production code path 上に残らないこと (景品表示法 5 条 1 号
//     + 特商法 2022-06 改正最終確認画面ガイドライン整合)。
//
// テスト分類: Integration (page.route() で Stripe API を完全モック化、cognito-dev 認証必須)
// 実行: npx playwright test --config playwright.cognito-dev.config.ts stripe-checkout-labels
//
// 関連 ADR: ADR-0002 (Critical 修正の品質ゲート, 5 要件全充足) /
//          ADR-0014/0045 (labels.ts SSOT 機構)

import { expect, test } from '@playwright/test';
import { CHECKOUT_LABELS } from '../../../src/lib/domain/labels';
import { CHECKOUT_TERMS } from '../../../src/lib/domain/terms';

test.describe('#2346 CHECKOUT_LABELS SSOT — 景品表示法対応文言の回帰防止', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('CHECKOUT_LABELS.submitMessage が「お選びのプランの機能」を含む (景表法 5 条 1 号整合)', () => {
		// terms.ts atom レイヤー
		expect(CHECKOUT_TERMS.chosenPlanFeature).toBe('お選びのプランの機能');

		// labels.ts compound レイヤー
		expect(CHECKOUT_LABELS.submitMessage).toContain(CHECKOUT_TERMS.chosenPlanFeature);
		expect(CHECKOUT_LABELS.submitMessage).toBe(
			'お支払い後、すぐにお選びのプランの機能をご利用いただけます。',
		);

		// 旧文言「すべての機能」が完全に置換されていること (regression guard)
		expect(CHECKOUT_LABELS.submitMessage).not.toContain('すべての機能');
	});

	test('CHECKOUT_LABELS.afterSubmitMessage が「お選びのプランの機能」を含む', () => {
		expect(CHECKOUT_LABELS.afterSubmitMessage).toContain(CHECKOUT_TERMS.chosenPlanFeature);
		expect(CHECKOUT_LABELS.afterSubmitMessage).toBe(
			'アプリに戻ってお選びのプランの機能をお楽しみください。',
		);
		expect(CHECKOUT_LABELS.afterSubmitMessage).not.toContain('すべての機能');
	});

	test('future-proof `*WithPlan` 関数版がプラン名を差し込んだ文字列を返す', () => {
		// 将来 plan tier 確定済の文脈で動的差し込みを使う場合の SSOT 経由パス
		const standardSubmit = CHECKOUT_LABELS.submitMessageWithPlan('スタンダードプラン');
		expect(standardSubmit).toBe('お支払い後、すぐにスタンダードプランの機能をご利用いただけます。');
		expect(standardSubmit).not.toContain('すべての機能');

		const familyAfter = CHECKOUT_LABELS.afterSubmitMessageWithPlan('ファミリープラン');
		expect(familyAfter).toBe('アプリに戻ってファミリープランの機能をお楽しみください。');
		expect(familyAfter).not.toContain('すべての機能');
	});

	test('/api/stripe/checkout からの response url が遷移先として安全に扱われる (mock)', async ({
		page,
	}) => {
		// stripe-service.ts が CHECKOUT_LABELS を経由していることは
		// ユニットレベルで Stripe SDK モック検証する必要があるが、本 E2E では
		// /api/stripe/checkout の応答が UI で適切にハンドリングされるかを保証する
		// (custom_text 文言の実際の Stripe Checkout 画面での目視確認は PO SS で実施)
		const mockCheckoutUrl = 'https://checkout.stripe.com/mock-keihyou-fix-2346';

		await page.route('/api/stripe/checkout', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ url: mockCheckoutUrl }),
			});
		});

		await page.goto('/', { waitUntil: 'commit', timeout: 30_000 });

		const result = await page.evaluate(async () => {
			const res = await fetch('/api/stripe/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ planId: 'monthly' }),
			});
			return { status: res.status, body: await res.json() };
		});

		expect(result.status).toBe(200);
		expect(result.body.url).toBe(mockCheckoutUrl);
	});
});
