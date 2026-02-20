<script lang="ts">
	import { Progress as ArkProgress } from '@ark-ui/svelte/progress';

	interface Props {
		value: number;
		max?: number;
		label?: string;
		color?: string;
		size?: 'sm' | 'md' | 'lg';
	}

	let { value, max = 100, label, color = 'var(--theme-primary)', size = 'md' }: Props = $props();

	const heightClasses = {
		sm: 'h-2',
		md: 'h-4',
		lg: 'h-6',
	};
</script>

<ArkProgress.Root {value} {max} class="w-full">
	{#if label}
		<div class="flex justify-between items-center mb-1">
			<ArkProgress.Label class="text-sm font-bold">{label}</ArkProgress.Label>
			<ArkProgress.ValueText class="text-sm text-[var(--color-text-muted)]" />
		</div>
	{/if}
	<ArkProgress.Track
		class="w-full bg-black/10 rounded-[var(--radius-full)] overflow-hidden {heightClasses[size]}"
	>
		<ArkProgress.Range
			class="h-full rounded-[var(--radius-full)] transition-[width] duration-500 ease-out"
			style="background-color: {color};"
		/>
	</ArkProgress.Track>
</ArkProgress.Root>
