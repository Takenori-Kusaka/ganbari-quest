// tests/unit/components/graduation-submit-cta.test.ts
// #4498 — 卒業ページの送信 CTA が「押した先」を正しく名乗ることを component 層で固定する。
//
// ## 旧実装の何が壊れていたか
//
// 課金プランの顧客が卒業を送信しても Stripe の解約フローには一切到達せず、
// 「卒業を完了する」というボタン名だけが残っていた。顧客は解約が完了したと誤認し、
// **課金が継続する**（特商法の解約導線の実効性に接続する）。
//
// server の遷移先は `tests/unit/routes/subscription-cancel-graduation.test.ts` が固定する。
// ここは **顧客の目に何が出るか** を固定する (push-down-pyramid、ADR-0061)。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { GRADUATION_LABELS } from '../../../src/lib/domain/labels';
import GraduationPage from '../../../src/routes/(parent)/admin/subscription/cancel/graduation/+page.svelte';

afterEach(() => cleanup());

// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の PageData 型を test で最小化する
function renderPage(props: Record<string, unknown>): any {
	return render(GraduationPage as never, {
		props: {
			data: {
				totalPoints: 0,
				yenAmount: 0,
				usagePeriodDays: 10,
				isPaidPlan: false,
				hasStripeCustomer: false,
				stripeEnabled: false,
				nicknameMaxLength: GRADUATION_LABELS.nicknameMaxLength,
				messageMaxLength: GRADUATION_LABELS.messageMaxLength,
				...props,
			},
			form: null,
		} as never,
	});
}

describe('卒業ページの送信 CTA (#4498)', () => {
	it('課金プランでは遷移先 (解約手続き) を名乗る', () => {
		renderPage({ isPaidPlan: true, hasStripeCustomer: true, stripeEnabled: true });

		const submit = screen.getByTestId('graduation-submit');
		expect(submit.textContent?.trim()).toBe(GRADUATION_LABELS.successProceedButton);
	});

	it('課金プランで「卒業を完了する」と名乗らない（解約完了の誤認を作らない）', () => {
		renderPage({ isPaidPlan: true, hasStripeCustomer: true, stripeEnabled: true });

		const submit = screen.getByTestId('graduation-submit');
		expect(submit.textContent).not.toContain('卒業を完了する');
		expect(submit.textContent).not.toContain('卒業のみ完了する');
	});

	it('無料プランは従来どおり卒業の完了を名乗る（既存挙動の回帰防止）', () => {
		renderPage({ isPaidPlan: false, hasStripeCustomer: false, stripeEnabled: false });

		const submit = screen.getByTestId('graduation-submit');
		expect(submit.textContent?.trim()).toBe(GRADUATION_LABELS.skipButton);
	});

	it('Stripe 未有効の環境では portal へ行かないので卒業の完了を名乗る', () => {
		// action 側も `stripeCustomerId && isStripeEnabled()` で判定するため名乗りと遷移先が一致する
		renderPage({ isPaidPlan: true, hasStripeCustomer: true, stripeEnabled: false });

		const submit = screen.getByTestId('graduation-submit');
		expect(submit.textContent?.trim()).toBe(GRADUATION_LABELS.skipButton);
	});
});
