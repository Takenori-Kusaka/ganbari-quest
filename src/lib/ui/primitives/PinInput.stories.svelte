<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import PinInput from './PinInput.svelte';

const { Story } = defineMeta({
	title: 'Primitives/PinInput',
	component: PinInput,
	tags: ['autodocs'],
	args: {
		length: 6,
		mask: true,
	},
});

// CompleteFlow story の play で「全 digit 入力 → onComplete 発火 + valueAsString shape」を
// 検証するため fn() spy を用意する (CX-DoR #8)。
const completeSpy = fn();
</script>

<Story name="Default" args={{ length: 6, mask: true }} />

<Story name="Unmasked" args={{ length: 6, mask: false }} />

<Story name="Length4" args={{ length: 4, mask: true }} />

<!--
  WithLabel (#3259 ux-1 follow-up): label prop で accessible name を上書きできることを固定。
  同一画面に複数 PinInput を置くとき (reset-pin の「確認コード」+「新しい PIN」) に
  汎用 'PINコード' が重複し SR で曖昧化する退行を防ぐ。custom label が描画され、
  既定の汎用ラベル 'PINコード' に退行していないことを assert する。
-->
<Story
	name="WithLabel"
	args={{ length: 4, mask: false, label: '確認コード（6桁の数字）' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// custom label が描画される (Ark Label → input 関連付け)。getByText は不在で throw。
		await waitFor(() => canvas.getByText('確認コード（6桁の数字）'));
		// 汎用既定ラベルに退行していない (重複の原因を回帰固定)。
		expect(canvas.queryByText('PINコード')).toBeNull();
	}}
/>

<!--
  CompleteFlow (length=4 / unmasked): 4 桁を順に入力 → onComplete が valueAsString='1234' で発火。
  mask=false で input が role=textbox になり Testing Library から query できる
  (mask=true は type=password で role を持たないため、操作回帰には unmasked を使う)。
-->
<Story
	name="CompleteFlow"
	args={{ length: 4, mask: false, onComplete: completeSpy }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// Ark PinInput は length 分の <input> を render する (HiddenInput を除く表示桁)。
		const inputs = await waitFor(() => {
			const found = canvas.getAllByRole('textbox');
			if (found.length < 4) throw new Error('pin inputs not ready');
			return found;
		});
		// 各桁にフォーカスして 1 文字ずつ入力 (Ark は入力で次桁へ自動 advance)。
		// noUncheckedIndexedAccess 下では index access が undefined を含むため digit ごとに guard。
		const digits = ['1', '2', '3', '4'];
		for (let i = 0; i < digits.length; i++) {
			const cell = inputs[i];
			const digit = digits[i];
			if (!cell || !digit) throw new Error(`pin cell ${i} missing`);
			await userEvent.type(cell, digit);
		}
		// 全桁入力完了 → onComplete 発火 + valueAsString が連結 '1234'
		await waitFor(() => expect(completeSpy).toHaveBeenCalledTimes(1));
		await expect(completeSpy).toHaveBeenCalledWith(
			expect.objectContaining({ valueAsString: '1234' }),
		);
	}}
/>
