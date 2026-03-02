<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		category: string;
		children: Snippet;
	}

	let { category, children }: Props = $props();

	const categoryColors: Record<string, string> = {
		うんどう: 'var(--color-cat-undou)',
		べんきょう: 'var(--color-cat-benkyou)',
		せいかつ: 'var(--color-cat-seikatsu)',
		こうりゅう: 'var(--color-cat-kouryuu)',
		そうぞう: 'var(--color-cat-souzou)',
	};

	const color = $derived(categoryColors[category] ?? 'var(--theme-primary)');
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
		<span class="text-xs font-bold text-[var(--color-text-muted)]">{category}</span>
	</h2>
	<div class="grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-1 px-1">
		{@render children()}
	</div>
</section>
