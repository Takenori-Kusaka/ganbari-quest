<script lang="ts">
import { PinInput as ArkPinInput } from '@ark-ui/svelte/pin-input';
import { UI_PRIMITIVES_LABELS } from '$lib/domain/labels';

interface Props {
	length?: number;
	mask?: boolean;
	/**
	 * accessible name (screen reader 読み上げラベル)。既定は汎用の「PINコード」。
	 * 同一画面に複数 PinInput を同時表示する場合は、各々に区別できる label を渡して
	 * accessible name の重複・曖昧化を防ぐこと (例: reset-pin の「確認コード」+「新しい PIN」)。
	 */
	label?: string;
	/**
	 * label の表示クラス。既定は `sr-only` (視覚的に隠し SR のみ)。視覚ラベルにしたい場合は
	 * 表示用クラスを渡す (Ark の Label → input 関連付けで重複なく 1 ラベルになる)。
	 */
	labelClass?: string;
	onComplete?: (details: { value: string[]; valueAsString: string }) => void;
}

let {
	length = 6,
	mask = true,
	label = UI_PRIMITIVES_LABELS.pinCodeLabel,
	labelClass = 'sr-only',
	onComplete,
}: Props = $props();

function handleValueComplete(details: { value: string[]; valueAsString: string }) {
	onComplete?.(details);
}
</script>

<!-- Root は flex-col だが gap を持たない: 視覚差分ゼロを保つため、ラベル ↔ 桁行の余白は
	可視ラベル側の margin (labelClass の mb-* 等) に委ねる。sr-only ラベル時は余白ゼロで
	桁行が最上段に来る (旧実装の単独桁行と同一)。桁ボックス間の gap は Control が持つ。 -->
<ArkPinInput.Root onValueComplete={handleValueComplete} {mask} type="numeric" class="flex flex-col">
	<ArkPinInput.Label class={labelClass}>{label}</ArkPinInput.Label>
	<ArkPinInput.Control class="flex gap-[var(--sp-sm)] justify-center">
		{#each Array(length) as _, i}
			<ArkPinInput.Input
				index={i}
				class="w-12 h-14 text-center text-xl font-bold border-2 border-[var(--theme-secondary)] rounded-[var(--radius-sm)]
					focus:border-[var(--theme-primary)] focus:outline-none transition-colors bg-white"
			/>
		{/each}
	</ArkPinInput.Control>
	<ArkPinInput.HiddenInput />
</ArkPinInput.Root>
