<script lang="ts">
	import Progress from '$lib/ui/primitives/Progress.svelte';

	interface Props {
		category: string;
		value: number;
		maxValue?: number;
		stars?: number;
	}

	let { category, value, maxValue = 100, stars = 0 }: Props = $props();

	const categoryColors: Record<string, string> = {
		うんどう: 'var(--color-cat-undou)',
		べんきょう: 'var(--color-cat-benkyou)',
		せいかつ: 'var(--color-cat-seikatsu)',
		こうりゅう: 'var(--color-cat-kouryuu)',
		そうぞう: 'var(--color-cat-souzou)',
	};

	const color = $derived(categoryColors[category] ?? 'var(--theme-primary)');
	const starText = $derived('★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars)));
</script>

<div class="flex items-center gap-[var(--spacing-sm)]">
	<span class="w-24 text-sm font-bold shrink-0 truncate">{category}</span>
	<div class="flex-1">
		<Progress {value} max={maxValue} {color} size="md" />
	</div>
	<span class="text-sm font-bold w-8 text-right">{Math.round(value)}</span>
	{#if stars > 0}
		<span class="text-sm w-12 text-[var(--color-point)]" aria-label="{stars}つ星">{starText}</span>
	{/if}
</div>
