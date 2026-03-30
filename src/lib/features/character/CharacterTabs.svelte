<script lang="ts">
import { page } from '$app/stores';

interface Props {
	uiMode: string;
}

let { uiMode }: Props = $props();

const tabsByMode: Record<string, { label: string; path: string }[]> = {
	baby: [
		{ label: 'つよさ', path: 'status' },
		{ label: 'じっせき', path: 'achievements' },
	],
	kinder: [
		{ label: 'つよさ', path: 'status' },
		{ label: 'じっせき', path: 'achievements' },
		{ label: 'しょうごう', path: 'titles' },
	],
	lower: [
		{ label: 'つよさ', path: 'status' },
		{ label: '実績', path: 'achievements' },
	],
	upper: [
		{ label: 'ステータス', path: 'status' },
		{ label: '実績', path: 'achievements' },
	],
	teen: [
		{ label: 'ステータス', path: 'status' },
		{ label: '実績', path: 'achievements' },
	],
};

const tabs = $derived(tabsByMode[uiMode] ?? tabsByMode.kinder);
</script>

<nav class="flex gap-1 bg-[var(--theme-nav)] rounded-[var(--radius-md)] p-1 mx-[var(--sp-md)] mb-[var(--sp-md)]">
	{#each tabs as tab (tab.path)}
		{@const active = $page.url.pathname.endsWith(`/${tab.path}`)}
		<a
			href="/{uiMode}/{tab.path}"
			data-sveltekit-noscroll
			class="flex-1 px-3 py-2 rounded-[var(--radius-sm)] text-sm font-bold text-center
				transition-colors {active ? 'bg-white text-[var(--theme-primary)] shadow-sm' : 'text-[var(--color-text-muted)]'}"
		>
			{tab.label}
		</a>
	{/each}
</nav>
