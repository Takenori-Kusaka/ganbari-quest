<script lang="ts">
import { page } from '$app/state';
import { ICON_HOME, ICON_STATUS, ICON_SWITCH } from '$lib/domain/icons';
import { playSound } from '$lib/ui/sound/play-sound';

interface NavItem {
	href: string;
	icon: string;
	label: string;
}

interface Props {
	items?: NavItem[];
	iconOnly?: boolean;
}

const defaultItems: NavItem[] = [
	{ href: '/home', icon: ICON_HOME, label: 'ホーム' },
	{ href: '/status', icon: ICON_STATUS, label: 'つよさ' },
	{ href: '/switch', icon: ICON_SWITCH, label: 'きりかえ' },
];

let { items = defaultItems, iconOnly = false }: Props = $props();

function isActive(href: string): boolean {
	return page.url.pathname.startsWith(href);
}
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-30 flex items-stretch justify-around
		bg-[var(--theme-nav)] border-t border-black/10 safe-area-bottom"
	data-testid="bottom-nav"
	aria-label="メインナビゲーション"
>
	{#each items as item (item.href)}
		<a
			href={item.href}
			use:playSound={'tap'}
			class="tap-target flex flex-col items-center justify-center gap-0.5 flex-1 py-[var(--sp-sm)]
				transition-colors min-h-16
				{isActive(item.href) ? 'text-[var(--theme-primary)] font-bold' : 'text-[var(--color-text-muted)]'}"
			aria-current={isActive(item.href) ? 'page' : undefined}
			aria-label={iconOnly ? item.label : undefined}
			data-tutorial={item.href.includes('/status') ? 'nav-status' : undefined}
		>
			<span class="{iconOnly ? 'text-3xl' : 'text-2xl'}" aria-hidden="true">{item.icon}</span>
			{#if !iconOnly}
				<span class="text-xs">{item.label}</span>
			{/if}
		</a>
	{/each}
</nav>

<style>
	.safe-area-bottom {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
</style>
