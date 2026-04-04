<script lang="ts">
import { navigating } from '$app/stores';
import { getModeLabels, ICON_HOME, ICON_STATUS, ICON_SWITCH } from '$lib/domain/icons';
import BottomNav from '$lib/ui/components/BottomNav.svelte';
import Header from '$lib/ui/components/Header.svelte';

let { data, children } = $props();

const theme = $derived(data.child?.theme ?? 'pink');
const uiMode = $derived(data.uiMode ?? 'kinder');

// #0289: 本番と同じナビ構成（3項目）に統一
const modeLabels = $derived(getModeLabels(uiMode));
const navItems = $derived([
	{
		href: `/demo/${uiMode}/home?childId=${data.child?.id ?? ''}`,
		icon: ICON_HOME,
		label: 'ホーム',
	},
	{
		href: `/demo/${uiMode}/status?childId=${data.child?.id ?? ''}`,
		icon: ICON_STATUS,
		label: modeLabels.status,
	},
	{ href: '/demo', icon: ICON_SWITCH, label: modeLabels.switch },
]);
</script>

<div data-theme={theme} data-age-tier={uiMode} class="min-h-dvh bg-[var(--theme-bg)]">
	{#if data.child}
		<Header
			nickname={data.child.nickname}
			totalPoints={data.balance}
			avatarUrl={data.child.avatarUrl}
			pointSettings={data.pointSettings}
		/>
	{/if}

	<main class="relative z-0 pb-20 pt-[var(--sp-sm)]">
		{#if $navigating}
			<div class="px-[var(--sp-md)] py-[var(--sp-sm)] flex flex-col gap-[var(--sp-md)]">
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
