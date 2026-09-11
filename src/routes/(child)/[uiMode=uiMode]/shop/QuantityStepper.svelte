<script lang="ts">
// #4407: ごほうび交換の個数 stepper。
// 単位量のごほうび (「ゲーム時間 +30分」等) を N 個ぶん 1 回で交換するための入力。
// キーボード入力を要求しないため preschool (tapSize 80px / ひらがな) でも操作できる。
// ConfirmExchangeDialog の style ブロックを 50 行以内に保つため分離 (docs/DESIGN.md §9)。

import { getChildShopLabels } from '$lib/domain/labels';
import { REDEMPTION_QUANTITY_MIN } from '$lib/domain/validation/special-reward';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	/** 現在の個数 (双方向)。 */
	quantity: number;
	/** 選べる上限 (残高で買える個数と値域上限の小さい方)。 */
	max: number;
	/** 年齢モード。文言の文体を決める (#4690、docs/DESIGN.md §8)。 */
	uiMode: string;
}

let { quantity = $bindable(), max, uiMode }: Props = $props();

const L = $derived(getChildShopLabels(uiMode));
</script>

<div class="stepper" data-testid="confirm-quantity-block">
	<span class="stepper-label">{L.quantityLabel}</span>
	<div class="stepper-row">
		<Button
			variant="outline"
			size="lg"
			disabled={quantity <= REDEMPTION_QUANTITY_MIN}
			onclick={() => {
				if (quantity > REDEMPTION_QUANTITY_MIN) quantity -= 1;
			}}
			aria-label={L.quantityDecreaseAriaLabel}
			data-testid="confirm-quantity-decrease"
		>
			{L.quantityDecreaseGlyph}
		</Button>
		<output
			class="stepper-value"
			aria-live="polite"
			aria-label={L.quantityValueAriaLabel(quantity)}
			data-testid="confirm-quantity-value"
		>
			{quantity}<span class="stepper-unit">{L.quantityUnit}</span>
		</output>
		<Button
			variant="outline"
			size="lg"
			disabled={quantity >= max}
			onclick={() => {
				if (quantity < max) quantity += 1;
			}}
			aria-label={L.quantityIncreaseAriaLabel}
			data-testid="confirm-quantity-increase"
		>
			{L.quantityIncreaseGlyph}
		</Button>
	</div>
</div>

<style>
	.stepper {
		display: flex; flex-direction: column; align-items: center; gap: var(--sp-xs);
		margin-top: var(--sp-xs);
	}
	.stepper-label { font-size: 0.85rem; color: var(--color-text-secondary); }
	.stepper-row { display: flex; align-items: center; gap: var(--sp-md); }
	.stepper-value {
		font-size: 2rem; font-weight: bold; color: var(--color-text); min-width: 3.5rem;
	}
	.stepper-unit { font-size: 0.9rem; font-weight: normal; margin-left: 2px; }
</style>
