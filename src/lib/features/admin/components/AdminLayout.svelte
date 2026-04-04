<script lang="ts">
import type { Snippet } from 'svelte';
import { navigating, page } from '$app/stores';
import Logo from '$lib/ui/components/Logo.svelte';
import TutorialOverlay from '$lib/ui/components/TutorialOverlay.svelte';
import { markTutorialStarted, startTutorial } from '$lib/ui/tutorial/tutorial-store.svelte';

interface Props {
	children: Snippet;
	mode: 'live' | 'demo';
	basePath: string;
	isPremium?: boolean;
	planTier?: 'free' | 'standard' | 'family';
}

let { children, mode, basePath, isPremium = false, planTier = 'free' }: Props = $props();

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
	{ href: `${basePath}/challenges`, label: 'チャレンジ', icon: '👥' },
	{ href: `${basePath}/reports`, label: 'レポート', icon: '📊' },
	{ href: `${basePath}/settings`, label: '設定', icon: '⚙️' },
]);

function isNavActive(itemHref: string, currentPath: string): boolean {
	if (itemHref === basePath) return currentPath === basePath;
	return currentPath.startsWith(itemHref);
}
</script>

<div data-theme="admin" data-plan={planTier} class="admin-shell">
	<!-- Admin Header -->
	<header class="admin-header sticky {isDemo ? 'top-10' : 'top-0'} z-30 backdrop-blur border-b border-gray-200 px-4 py-3">
		<div class="max-w-4xl mx-auto flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Logo variant="compact" size={120} planTier={isPremium ? planTier : undefined} />
				<span class="text-xs font-medium text-gray-400 border border-gray-300 rounded px-1.5 py-0.5">管理</span>
				{#if isDemo}
					<span class="text-xs font-medium text-amber-500 border border-amber-300 rounded px-1.5 py-0.5">デモ</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if !isDemo && !isPremium}
					<a
						href="{basePath}/license"
						class="upgrade-btn"
						data-tutorial="upgrade-btn"
					>
						⭐ アップグレード
					</a>
				{:else if !isDemo && planTier === 'standard'}
					<span class="plan-badge plan-badge--standard">⭐ プレミアム</span>
				{:else if !isDemo && planTier === 'family'}
					<span class="plan-badge plan-badge--family">⭐⭐ ファミリー</span>
				{/if}
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
					class="nav-item {isActive ? 'nav-item--active' : ''}"
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
					class="mobile-nav-item {isActive ? 'mobile-nav-item--active' : ''}"
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

<style>
	.admin-shell {
		min-height: 100dvh;
		background: linear-gradient(to bottom, var(--plan-page-from, #eff6ff), var(--plan-page-to, #dbeafe));
	}
	.admin-header {
		background: var(--plan-header-bg, rgba(255, 255, 255, 0.8));
	}
	.upgrade-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 12px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-premium);
		background: var(--color-premium-bg);
		border-radius: var(--radius-full);
		text-decoration: none;
		transition: all 0.15s ease;
		white-space: nowrap;
	}
	.upgrade-btn:hover {
		background: var(--color-premium);
		color: white;
	}
	.plan-badge {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 3px 10px;
		font-size: 0.7rem;
		font-weight: 700;
		border-radius: 9999px;
		white-space: nowrap;
	}
	.plan-badge--standard {
		background: var(--plan-badge-bg, #f3e8ff);
		color: var(--plan-badge-text, #6d28d9);
	}
	.plan-badge--family {
		background: var(--plan-badge-bg, #fef3c7);
		color: var(--plan-badge-text, #92400e);
	}
	/* Desktop nav */
	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		transition: all 0.15s;
		white-space: nowrap;
		color: var(--color-text-secondary, #4b5563);
	}
	.nav-item:hover {
		background: var(--plan-nav-bg, #e8f4fd);
		color: var(--plan-nav-text, var(--color-brand-600));
	}
	.nav-item--active {
		background: var(--plan-nav-active, #dbeafe);
		color: var(--plan-nav-text, var(--color-brand-700));
	}
	/* Mobile nav */
	.mobile-nav-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		width: 4rem;
		height: 100%;
		transition: color 0.15s;
		color: var(--color-text-tertiary, #9ca3af);
	}
	.mobile-nav-item:hover {
		color: var(--color-text-secondary, #4b5563);
	}
	.mobile-nav-item--active {
		color: var(--plan-primary, var(--color-brand-600));
	}
</style>
