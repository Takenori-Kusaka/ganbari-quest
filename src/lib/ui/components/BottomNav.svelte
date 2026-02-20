<script lang="ts">
	import { page } from '$app/state';

	interface NavItem {
		href: string;
		icon: string;
		label: string;
	}

	interface Props {
		items?: NavItem[];
	}

	const defaultItems: NavItem[] = [
		{ href: '/home', icon: '🏠', label: 'ホーム' },
		{ href: '/history', icon: '📋', label: 'きろく' },
		{ href: '/status', icon: '⭐', label: 'つよさ' },
		{ href: '/switch', icon: '👤', label: 'きりかえ' },
	];

	let { items = defaultItems }: Props = $props();

	function isActive(href: string): boolean {
		return page.url.pathname.startsWith(href);
	}
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-30 flex items-stretch justify-around
		bg-[var(--theme-nav)] border-t border-black/10 safe-area-bottom"
	aria-label="メインナビゲーション"
>
	{#each items as item (item.href)}
		<a
			href={item.href}
			class="tap-target flex flex-col items-center justify-center gap-0.5 flex-1 py-[var(--spacing-sm)]
				transition-colors min-h-16
				{isActive(item.href) ? 'text-[var(--theme-primary)] font-bold' : 'text-[var(--color-text-muted)]'}"
			aria-current={isActive(item.href) ? 'page' : undefined}
		>
			<span class="text-2xl" aria-hidden="true">{item.icon}</span>
			<span class="text-xs">{item.label}</span>
		</a>
	{/each}
</nav>

<style>
	.safe-area-bottom {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
</style>
