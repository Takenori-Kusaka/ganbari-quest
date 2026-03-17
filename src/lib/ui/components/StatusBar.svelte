<script lang="ts">
import { getCategoryById } from '$lib/domain/validation/activity';
import Progress from '$lib/ui/primitives/Progress.svelte';

interface Props {
	categoryId: number;
	value: number;
	maxValue?: number;
	stars?: number;
}

let { categoryId, value, maxValue = 100, stars = 0 }: Props = $props();

const catDef = $derived(getCategoryById(categoryId));
const color = $derived(catDef?.color ?? 'var(--theme-primary)');
const categoryName = $derived(catDef?.name ?? '');
const starText = $derived('★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars)));
</script>

<div class="flex items-center gap-[var(--spacing-sm)]">
	<span class="w-24 text-sm font-bold shrink-0 truncate">{categoryName}</span>
	<div class="flex-1">
		<Progress {value} max={maxValue} {color} size="md" />
	</div>
	<span class="text-sm font-bold w-8 text-right">{Math.round(value)}</span>
	{#if stars > 0}
		<span class="text-sm w-12 text-[var(--color-point)]" aria-label="{stars}つ星">{starText}</span>
	{/if}
</div>
