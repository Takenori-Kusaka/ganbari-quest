<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getCategoryById } from '$lib/domain/validation/activity';

	interface Props {
		categoryId: number;
		children: Snippet;
	}

	let { categoryId, children }: Props = $props();

	const catDef = $derived(getCategoryById(categoryId));
	const color = $derived(catDef?.color ?? 'var(--theme-primary)');
	const name = $derived(catDef?.name ?? '');
</script>

<section class="mb-[var(--spacing-sm)]">
	<h2
		class="flex items-center gap-1 mb-1 px-1"
	>
		<span
			class="w-1 h-4 rounded-[var(--radius-full)]"
			style="background-color: {color};"
			aria-hidden="true"
		></span>
		<span class="text-xs font-bold text-[var(--color-text-muted)]">{name}</span>
	</h2>
	<div class="grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-1 px-1">
		{@render children()}
	</div>
</section>
