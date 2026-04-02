<script lang="ts">
import { navigating, page } from '$app/stores';
import Logo from '$lib/ui/components/Logo.svelte';
import TutorialOverlay from '$lib/ui/components/TutorialOverlay.svelte';
import { markTutorialStarted, startTutorial } from '$lib/ui/tutorial/tutorial-store.svelte';
import type { Snippet } from 'svelte';

interface Props {
	children: Snippet;
	mode: 'live' | 'demo';
	basePath: string;
}

let { children, mode, basePath }: Props = $props();

const isDemo = $derived(mode === 'demo');

async function handleStartTutorial() {
	await markTutorialStarted();
	await startTutorial();
}

// bfcache recovery (production only)
$effect(() => {
	if (isDemo) return;
	const handlePageShow = (e: PageTransitionEvent) => {
		if (e.persisted) {
			window.location.reload();
		}
	};
	window.addEventListener('pageshow', handlePageShow);
	return () => window.removeEventListener('pageshow', handlePageShow);
});

const primaryNavItems = $derived([
	{ href: basePath, label: 'ホーム', icon: '🏠' },
	{ href: `${basePath}/activities`, label: '活動', icon: '📋' },
	{ href: `${basePath}/children`, label: 'こども', icon: '👧' },
	{ href: `${basePath}/points`, label: 'ポイント', icon: '⭐' },
	{ href: `${basePath}/events`, label: 'イベント', icon: '🎉' },
	{ href: `${basePath}/settings`, label: '設定', icon: '⚙️' },
]);

function isNavActive(itemHref: string, currentPath: string): boolean {
	if (itemHref === basePath) return currentPath === basePath;
	return currentPath.startsWith(itemHref);
}
</script>

<div data-theme="admin" class="min-h-dvh bg-gradient-to-b from-blue-50 to-blue-100">
	<!-- Admin Header -->
	<header class="sticky {isDemo ? 'top-10' : 'top-0'} z-30 bg-white/80 backdrop-blur border-b border-gray-200 px-4 py-3">
		<div class="max-w-4xl mx-auto flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Logo variant="compact" size={120} />
				<span class="text-xs font-medium text-gray-400 border border-gray-300 rounded px-1.5 py-0.5">管理</span>
				{#if isDemo}
					<span class="text-xs font-medium text-amber-500 border border-amber-300 rounded px-1.5 py-0.5">デモ</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if !isDemo}
					<button
						onclick={handleStartTutorial}
						class="w-8 h-8 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors text-sm font-bold"
						title="チュートリアルを開始"
						data-tutorial="tutorial-restart"
					>
						?
					</button>
				{/if}
				<a
					href={isDemo ? '/demo' : '/switch'}
					class="text-sm px-3 py-1 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 transition-colors inline-flex items-center gap-1"
					data-tutorial="switch-to-child"
				>
					<span aria-hidden="true">&larr;</span>
					{isDemo ? 'デモトップ' : '子供画面へ'}
				</a>
			</div>
		</div>
	</header>

	<!-- Desktop Navigation (>=768px) -->
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
				{#if !isDemo}
					<div class="skeleton-block h-24 rounded-lg"></div>
				{/if}
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>

	<!-- Mobile Bottom Navigation (<768px) -->
	<nav class="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 safe-area-bottom" aria-label="メインナビゲーション" data-tutorial="nav-primary">
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

	{#if !isDemo}
		<TutorialOverlay />
	{/if}
</div>
