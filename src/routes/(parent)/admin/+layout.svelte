<script lang="ts">
import { navigating, page } from '$app/stores';
import Logo from '$lib/ui/components/Logo.svelte';
import type { Snippet } from 'svelte';

interface Props {
	children: Snippet;
}

let { children }: Props = $props();

// bfcache からの復元時にページをリロードしてサーバー認証チェックを発火させる
$effect(() => {
	const handlePageShow = (e: PageTransitionEvent) => {
		if (e.persisted) {
			window.location.reload();
		}
	};
	window.addEventListener('pageshow', handlePageShow);
	return () => window.removeEventListener('pageshow', handlePageShow);
});

const primaryNavItems = [
	{ href: '/admin', label: 'ホーム', icon: '🏠' },
	{ href: '/admin/activities', label: '活動', icon: '📋' },
	{ href: '/admin/children', label: 'こども', icon: '👧' },
	{ href: '/admin/points', label: 'ポイント', icon: '⭐' },
	{ href: '/admin/settings', label: '設定', icon: '⚙️' },
];

function isNavActive(itemHref: string, currentPath: string): boolean {
	if (itemHref === '/admin') return currentPath === '/admin';
	return currentPath.startsWith(itemHref);
}
</script>

<div data-theme="admin" class="min-h-dvh bg-gradient-to-b from-blue-50 to-blue-100">
	<!-- Admin Header -->
	<header class="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-gray-200 px-4 py-3">
		<div class="max-w-4xl mx-auto flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Logo variant="compact" />
				<span class="text-xs font-medium text-gray-400 border border-gray-300 rounded px-1.5 py-0.5">管理</span>
			</div>
			<form method="POST" action="/api/v1/auth/logout">
				<button
					type="submit"
					class="text-sm px-3 py-1 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 transition-colors"
				>
					ログアウト
				</button>
			</form>
		</div>
	</header>

	<!-- Desktop Navigation (≥768px) -->
	<nav class="hidden md:block bg-white border-b border-gray-100 px-4 py-2">
		<div class="max-w-4xl mx-auto flex gap-1">
			{#each primaryNavItems as item}
				{@const isActive = isNavActive(item.href, $page.url.pathname)}
				<a
					href={item.href}
					class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap
						{isActive
						? 'bg-blue-100 text-blue-700'
						: 'text-gray-600 hover:bg-blue-50 hover:text-blue-600'}"
					aria-current={isActive ? 'page' : undefined}
				>
					<span aria-hidden="true">{item.icon}</span>
					{item.label}
				</a>
			{/each}
		</div>
	</nav>

	<!-- Main content -->
	<main class="max-w-4xl mx-auto p-4 pb-24 md:pb-4">
		{#if $navigating}
			<div class="flex flex-col gap-4">
				<div class="skeleton-block h-10 w-48 rounded-lg"></div>
				<div class="skeleton-block h-24 rounded-lg"></div>
				<div class="skeleton-block h-24 rounded-lg"></div>
				<div class="skeleton-block h-24 rounded-lg"></div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>

	<!-- Mobile Bottom Navigation (<768px) -->
	<nav class="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 safe-area-bottom" aria-label="メインナビゲーション">
		<div class="flex justify-around items-center h-16">
			{#each primaryNavItems as item}
				{@const isActive = isNavActive(item.href, $page.url.pathname)}
				<a
					href={item.href}
					class="flex flex-col items-center justify-center gap-0.5 w-16 h-full transition-colors
						{isActive ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}"
					aria-current={isActive ? 'page' : undefined}
				>
					<span class="text-xl" aria-hidden="true">{item.icon}</span>
					<span class="text-[10px] font-medium leading-none">{item.label}</span>
				</a>
			{/each}
		</div>
	</nav>
</div>
