// tests/unit/components/cancel-thanks-dead-end.test.ts
// #4329 ① — 解約 thanks 画面が「顧客に結果を伝える」ことを component 層で固定する。
//
// ## 旧実装の何が壊れていたか
//
// portal 作成に失敗した顧客に対し、画面は「ご回答ありがとうございました」だけを見せ、
// CTA は「Stripe 請求管理ページで解約を完了する」と名乗りながら `href="/admin/subscription"`
// = **自アプリのプラン画面へ戻すだけ**だった。押しても Stripe に行かないので解約は完了せず、
// 顧客は解約したつもりのまま課金が続く。
//
// server の redirect 先は `subscription-cancel-portal-dead-end.test.ts` が固定する。
// ここは **顧客の目に何が出るか**を固定する (push-down-pyramid、ADR-0061)。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { CANCELLATION_LABELS } from '../../../src/lib/domain/labels';
import CancelThanksPage from '../../../src/routes/(parent)/admin/subscription/cancel/thanks/+page.svelte';

afterEach(() => cleanup());

// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の PageData 型を test で最小化する
function renderPage(props: Record<string, unknown>): any {
	return render(CancelThanksPage as never, {
		props: {
			data: {
				isPaidPlan: false,
				hasStripeCustomer: false,
				stripeEnabled: false,
				portalUnavailable: false,
				labels: CANCELLATION_LABELS,
				...props,
			},
			form: (props.form as unknown) ?? null,
		} as never,
	});
}

describe('解約手続きが残っているとき (#4329 AC1 / AC2 / AC3)', () => {
	it('AC1: 手続きが残っていることを assertive に伝える (無言で成功に見せない)', () => {
		renderPage({ portalUnavailable: true });

		const banner = screen.getByTestId('cancellation-portal-unavailable');
		expect(banner.getAttribute('role')).toBe('alert');
		expect(banner.textContent).toContain(CANCELLATION_LABELS.portalUnavailableHeading);
	});

	it('AC2: Stripe へ行くと名乗る CTA が自アプリのページへ戻すリンクになっていない', () => {
		renderPage({ portalUnavailable: true });

		const cta = screen.getByTestId('cancellation-proceed-stripe');
		// 旧実装は <a href="/admin/subscription">。名乗りと遷移先が食い違っていた。
		expect(cta.tagName).toBe('BUTTON');
		expect(cta.getAttribute('href')).toBeNull();
		expect(cta.closest('form')?.getAttribute('action')).toBe('?/openPortal');
	});

	it('AC3: portal に到達できない場合の代替手段 (サポート窓口) を提示する', () => {
		renderPage({ portalUnavailable: true });

		expect(screen.getByTestId('cancellation-support-link').getAttribute('href')).toBe(
			'/admin/settings/support',
		);
	});

	it('再試行も失敗したら、その結果を画面に出す (押して無反応にしない)', () => {
		renderPage({ portalUnavailable: true, form: { portalRetryFailed: true } });

		const failure = screen.getByTestId('cancellation-portal-retry-failed');
		expect(failure.getAttribute('role')).toBe('alert');
		expect(failure.textContent).toContain(CANCELLATION_LABELS.portalRetryFailed);
	});

	it('内部の失敗コードを顧客に見せない (ADR-0062)', () => {
		const { container } = renderPage({
			portalUnavailable: true,
			form: { portalRetryFailed: true },
		});

		expect(container.textContent).not.toContain('PORTAL_CREATE_FAILED');
		expect(container.textContent).not.toContain('Stripe API');
	});
});

describe('手続きが残っていないとき (無料プラン等)', () => {
	it('解約が残っている旨のバナー / 再試行 CTA を出さない', () => {
		renderPage({ portalUnavailable: false });

		expect(screen.queryByTestId('cancellation-portal-unavailable')).toBeNull();
		expect(screen.queryByTestId('cancellation-proceed-stripe')).toBeNull();
	});

	it('「アカウント削除はこちら」は実際にアカウント削除の場所へ行く (文言と遷移先の一致)', () => {
		renderPage({ portalUnavailable: false });

		expect(screen.getByTestId('cancellation-account-delete-link').getAttribute('href')).toBe(
			'/admin/settings/account',
		);
	});
});
