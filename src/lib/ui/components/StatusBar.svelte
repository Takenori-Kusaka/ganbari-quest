<script lang="ts">
import { getCategoryById } from '$lib/domain/validation/activity';
import Progress from '$lib/ui/primitives/Progress.svelte';

interface Props {
	categoryId: number;
	value: number;
	maxValue?: number;
}

let { categoryId, value, maxValue = 100 }: Props = $props();

const catDef = $derived(getCategoryById(categoryId));
const color = $derived(catDef?.color ?? 'var(--theme-primary)');
const categoryName = $derived(catDef?.name ?? '');
</script>

<div class="flex items-center gap-[var(--spacing-sm)]">
	<span class="w-24 text-sm font-bold shrink-0 truncate">{categoryName}</span>
	<div class="flex-1">
		<Progress {value} max={maxValue} {color} size="md" />
	</div>
	<span class="text-sm font-bold w-8 text-right">{Math.round(value)}</span>
</div>
