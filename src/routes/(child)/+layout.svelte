<script lang="ts">
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';

let { data, children } = $props();

const theme = $derived(data.child?.theme ?? 'pink');
</script>

<div data-theme={theme} class="min-h-dvh bg-[var(--theme-bg)]">
	{#if data.child}
		<Header nickname={data.child.nickname} totalPoints={data.balance} level={data.level} />
	{/if}

	<main class="pb-20 pt-[var(--spacing-sm)]">
		{@render children()}
	</main>

	<BottomNav />
</div>
