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
		おてつだい: 'var(--color-cat-otetsudai)',
		コミュニケーション: 'var(--color-cat-comm)',
		せいかつ: 'var(--color-cat-seikatsu)',
	};

	const color = $derived(categoryColors[category] ?? 'var(--theme-primary)');
</script>

<section class="mb-[var(--spacing-lg)]">
	<h2
		class="flex items-center gap-[var(--spacing-sm)] mb-[var(--spacing-sm)] px-[var(--spacing-sm)]"
	>
		<span
			class="w-1.5 h-6 rounded-[var(--radius-full)]"
			style="background-color: {color};"
			aria-hidden="true"
		></span>
		<span class="text-sm font-bold text-[var(--color-text-muted)]">{category}</span>
	</h2>
	<div class="flex flex-wrap gap-[var(--spacing-sm)] px-[var(--spacing-sm)]">
		{@render children()}
	</div>
</section>
