<script lang="ts">
import { page } from '$app/stores';
import {
	ICON_ACHIEVEMENTS,
	ICON_HISTORY,
	ICON_STATUS,
	getModeLabels,
} from '$lib/domain/icons';

interface Props {
	uiMode: string;
}

let { uiMode }: Props = $props();

const labels = $derived(getModeLabels(uiMode));

// upper/teen はステータスアイコンに📊を使用
const statusIcon = $derived(uiMode === 'upper' || uiMode === 'teen' ? '📊' : ICON_STATUS);

interface TabDef {
	label: string;
	icon: string;
	path: string;
}

const tabsByMode: Record<string, TabDef[]> = {
	baby: [
		{ label: 'つよさ', icon: ICON_STATUS, path: 'status' },
		{ label: 'じっせき', icon: ICON_ACHIEVEMENTS, path: 'achievements' },
	],
	kinder: [
		{ label: 'つよさ', icon: ICON_STATUS, path: 'status' },
		{ label: 'じっせき', icon: ICON_ACHIEVEMENTS, path: 'achievements' },
		{ label: 'きろく', icon: ICON_HISTORY, path: 'history' },
	],
	lower: [
		{ label: 'つよさ', icon: ICON_STATUS, path: 'status' },
		{ label: '実績', icon: ICON_ACHIEVEMENTS, path: 'achievements' },
		{ label: '記録', icon: ICON_HISTORY, path: 'history' },
	],
	upper: [
		{ label: 'ステータス', icon: '📊', path: 'status' },
		{ label: '実績', icon: ICON_ACHIEVEMENTS, path: 'achievements' },
		{ label: '記録', icon: ICON_HISTORY, path: 'history' },
	],
	teen: [
		{ label: 'ステータス', icon: '📊', path: 'status' },
		{ label: '実績', icon: ICON_ACHIEVEMENTS, path: 'achievements' },
		{ label: '記録', icon: ICON_HISTORY, path: 'history' },
	],
};

const tabs = $derived(tabsByMode[uiMode] ?? tabsByMode.kinder);
</script>

<nav
	class="character-tabs"
	data-testid="character-tabs"
>
	{#each tabs as tab (tab.path)}
		{@const active = $page.url.pathname.endsWith(`/${tab.path}`)}
		<a
			href="/{uiMode}/{tab.path}"
			data-sveltekit-noscroll
			class="character-tab"
			class:active
			aria-current={active ? 'page' : undefined}
		>
			<span class="character-tab__icon">{tab.icon}</span>
			<span class="character-tab__label">{tab.label}</span>
		</a>
	{/each}
</nav>

<style>
	.character-tabs {
		display: flex;
		gap: 4px;
		background: var(--theme-nav);
		border-radius: var(--radius-md);
		padding: 4px;
		margin: 0 var(--sp-md) var(--sp-md);
	}

	.character-tab {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 4px;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: var(--color-text-muted);
		transition: all 0.15s ease;
		min-height: 56px;
		justify-content: center;
	}

	.character-tab.active {
		background: white;
		color: var(--theme-primary);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.character-tab__icon {
		font-size: 1.25rem;
		line-height: 1;
	}

	.character-tab__label {
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.2;
		text-align: center;
		white-space: nowrap;
	}

	/* baby/kinder はアイコンを大きめに */
	:global([data-age-tier='baby']) .character-tab__icon,
	:global([data-age-tier='kinder']) .character-tab__icon {
		font-size: 1.5rem;
	}

	:global([data-age-tier='baby']) .character-tab,
	:global([data-age-tier='kinder']) .character-tab {
		min-height: 60px;
		padding: 10px 4px;
	}
</style>
