<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, screen, waitFor } from 'storybook/test';
import { CHECKOUT_LABELS, STORYBOOK_LABELS } from '$lib/domain/labels';
import { TOKUSHOHO_TERMS } from '$lib/domain/terms';
import Alert from '$lib/ui/primitives/Alert.svelte';

const L = STORYBOOK_LABELS.checkoutSubmitMessage;

// Stripe Checkout の `custom_text.submit.message` は Stripe 側が描画するため、
// demo 環境 (`DATA_SOURCE=demo`) でも本番でも手元で SS を撮れない (#2573)。
// 顧客が申込確定ボタンを押す直前に読む文面を、この story で目視できるようにする。
// 改行 (`\n`) は Stripe が段落として描画するため、ここでも行ごとに <p> で出す。
const lines = CHECKOUT_LABELS.submitMessage.split('\n');

const { Story } = defineMeta({
	title: 'Features/Admin/CheckoutSubmitMessage',
	component: Alert,
	tags: ['autodocs'],
});
</script>

<!--
  Default: 申込確定直前に出る 2 ブロック (引渡時期・自動更新 / 申込撤回・解約方法)。
  play は「3 つの事実が読める」ことを操作結果として固定する
  (① 毎月の自動更新 ② 解約の方法 ③ 提供開始時期)。
-->
<Story
	name="Default"
	args={{ variant: 'info', 'data-testid': 'checkout-submit-message' }}
	play={async () => {
		const box = await waitFor(() => screen.getByTestId('checkout-submit-message'));
		await expect(box).toBeVisible();

		const text = box.textContent ?? '';
		// ① 自動更新
		await expect(text).toContain(TOKUSHOHO_TERMS.heading4Delivery);
		await expect(text).toContain('毎月');
		await expect(text).toContain('自動課金');
		// ② 解約方法
		await expect(text).toContain(TOKUSHOHO_TERMS.heading5Cancel);
		await expect(text).toContain('請求管理ページを開く');
		// ③ 提供開始時期
		await expect(text).toContain('お支払い後、すぐに');
		// 景品表示法 5 条 1 号 (優良誤認) の regression guard (#2346)
		await expect(text).not.toContain('すべての機能');
	}}
>
	{#snippet children()}
		<p>{L.caption}</p>
		{#each lines as line (line)}
			<p>{line}</p>
		{/each}
	{/snippet}
</Story>
