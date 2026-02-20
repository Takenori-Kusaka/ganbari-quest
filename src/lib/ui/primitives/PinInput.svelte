<script lang="ts">
	import { PinInput as ArkPinInput } from '@ark-ui/svelte/pin-input';

	interface Props {
		length?: number;
		mask?: boolean;
		onComplete?: (details: { value: string[]; valueAsString: string }) => void;
	}

	let { length = 6, mask = true, onComplete }: Props = $props();

	function handleValueComplete(details: { value: string[]; valueAsString: string }) {
		onComplete?.(details);
	}
</script>

<ArkPinInput.Root
	onValueComplete={handleValueComplete}
	{mask}
	type="numeric"
	class="flex gap-[var(--spacing-sm)] justify-center"
>
	<ArkPinInput.Label class="sr-only">PINコード</ArkPinInput.Label>
	{#each Array(length) as _, i}
		<ArkPinInput.Input
			index={i}
			class="w-12 h-14 text-center text-xl font-bold border-2 border-[var(--theme-secondary)] rounded-[var(--radius-sm)]
				focus:border-[var(--theme-primary)] focus:outline-none transition-colors bg-white"
		/>
	{/each}
	<ArkPinInput.HiddenInput />
</ArkPinInput.Root>
