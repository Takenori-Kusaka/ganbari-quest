<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { CHECKOUT_RECONCILIATION_LABELS } from '$lib/domain/labels';
import CheckoutReconciliationBanner from './CheckoutReconciliationBanner.svelte';

// #3958: Stripe checkout の success_url (`?session_id=cs_…`) から /admin/subscription へ
// 戻ったときの照合結果バナー。実 Stripe session が要る画面のため、3 状態の見た目と
// 文言はここで検証する (表示文言は CHECKOUT_RECONCILIATION_LABELS SSOT 経由)。
const { Story } = defineMeta({
	title: 'Admin/CheckoutReconciliationBanner',
	component: CheckoutReconciliationBanner,
	tags: ['autodocs'],
});
</script>

<!-- webhook 未達の救済が成立し、本経路で契約を反映した状態。再確認ボタンは出さない。 -->
<Story
	name="Applied"
	args={{ result: { status: 'applied' } }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const banner = canvas.getByTestId('checkout-reconciliation-banner');
		await expect(banner).toBeVisible();
		await expect(banner).toHaveTextContent(CHECKOUT_RECONCILIATION_LABELS.applied);
		await expect(canvas.queryByTestId('checkout-reconciliation-recheck')).toBeNull();
	}}
/>

<!-- webhook が先に届いていた / 同じ URL を再訪した状態。書き込みも通知も発生していない。 -->
<Story
	name="AlreadyApplied"
	args={{ result: { status: 'already_applied' } }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId('checkout-reconciliation-banner')).toHaveTextContent(
			CHECKOUT_RECONCILIATION_LABELS.alreadyApplied,
		);
	}}
/>

<!-- Stripe 上まだ支払いが確定していない状態。再確認ボタンで load を再実行できる。 -->
<Story
	name="Pending"
	args={{ result: { status: 'pending' } }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const banner = canvas.getByTestId('checkout-reconciliation-banner');
		await expect(banner).toHaveTextContent(CHECKOUT_RECONCILIATION_LABELS.pending);
		// 進行中を可視化する再確認導線 (NN/G #1) が押せる状態で出ている
		const recheck = canvas.getByTestId('checkout-reconciliation-recheck');
		await expect(recheck).toBeVisible();
		await expect(recheck).toBeEnabled();
	}}
/>

<!-- 期限切れ / 不正な session_id / 一時障害。プラン表示は既存の値にフォールバックする。 -->
<Story
	name="Unresolved"
	args={{ result: { status: 'not_found' } }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId('checkout-reconciliation-banner')).toHaveTextContent(
			CHECKOUT_RECONCILIATION_LABELS.unresolved,
		);
		await expect(canvas.getByTestId('checkout-reconciliation-recheck')).toBeVisible();
	}}
/>

<!-- Stripe 連携が無効な環境 (NUC / local)。顧客に伝えることがないため何も描画しない。 -->
<Story
	name="Unavailable"
	args={{ result: { status: 'unavailable' } }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByTestId('checkout-reconciliation-banner')).toBeNull();
	}}
/>
