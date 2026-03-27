<script lang="ts">
import { navigating } from '$app/stores';
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';

let { data, children } = $props();

const theme = $derived(data.child?.theme ?? 'pink');
const uiMode = $derived(data.uiMode ?? 'kinder');

const navItems = $derived([
	{ href: `/demo/${uiMode}/home?childId=${data.child?.id ?? ''}`, icon: '🏠', label: 'ホーム' },
	{ href: `/demo/${uiMode}/history?childId=${data.child?.id ?? ''}`, icon: '📋', label: 'きろく' },
	{ href: `/demo/${uiMode}/status?childId=${data.child?.id ?? ''}`, icon: '⭐', label: 'つよさ' },
	{
		href: `/demo/${uiMode}/achievements?childId=${data.child?.id ?? ''}`,
		icon: '🏆',
		label: 'じっせき',
	},
	{ href: '/demo', icon: '👤', label: 'きりかえ' },
]);
</script>

<div data-theme={theme} data-age-tier={uiMode} class="min-h-dvh bg-[var(--theme-bg)]">
	{#if data.child}
		<Header
			nickname={data.child.nickname}
			totalPoints={data.balance}
			level={data.level}
			showLevel={true}
			avatarUrl={data.child.avatarUrl}
			avatarConfig={data.avatarConfig}
			pointSettings={data.pointSettings}
		/>
	{/if}

	<main class="pb-20 pt-[var(--spacing-sm)]">
		{#if $navigating}
			<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)] flex flex-col gap-[var(--spacing-md)]">
				<div class="skeleton-block h-32 rounded-[var(--radius-md)]"></div>
				<div class="skeleton-block h-20 rounded-[var(--radius-md)]"></div>
				<div class="skeleton-block h-20 rounded-[var(--radius-md)]"></div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>

	<BottomNav items={navItems} />
</div>
