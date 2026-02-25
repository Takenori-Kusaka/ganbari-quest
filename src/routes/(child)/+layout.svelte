<script lang="ts">
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';

let { data, children } = $props();

const theme = $derived(data.child?.theme ?? 'pink');
const uiMode = $derived(data.uiMode ?? 'kinder');
const navItems = $derived([
	{ href: `/${uiMode}/home`, icon: '🏠', label: 'ホーム' },
	{ href: `/${uiMode}/history`, icon: '📋', label: 'きろく' },
	{ href: `/${uiMode}/status`, icon: '⭐', label: 'つよさ' },
	{ href: '/switch', icon: '👤', label: 'きりかえ' },
]);
</script>

<div data-theme={theme} data-age-tier={uiMode} class="min-h-dvh bg-[var(--theme-bg)]">
	{#if data.child}
		<Header nickname={data.child.nickname} totalPoints={data.balance} level={data.level} />
	{/if}

	<main class="pb-20 pt-[var(--spacing-sm)]">
		{@render children()}
	</main>

	<BottomNav items={navItems} />
</div>
