<script lang="ts">
import type { Snippet } from 'svelte';
import { navigating, page } from '$app/stores';
import Logo from '$lib/ui/components/Logo.svelte';
import TutorialOverlay from '$lib/ui/components/TutorialOverlay.svelte';
import { markTutorialStarted, startTutorial } from '$lib/ui/tutorial/tutorial-store.svelte';

interface NavItem {
	href: string;
	label: string;
	icon: string;
}

interface NavCategory {
	id: string;
	label: string;
	icon: string;
	items: NavItem[];
}

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

const navCategories: NavCategory[] = $derived([
	{
		id: 'monitor',
		label: 'みまもり',
		icon: '📊',
		items: [
			{ href: `${basePath}/reports`, label: 'レポート', icon: '📊' },
			{ href: `${basePath}/growth-book`, label: 'グロースブック', icon: '📚' },
			{ href: `${basePath}/achievements`, label: 'チャレンジ履歴', icon: '🏅' },
		],
	},
	{
		id: 'encourage',
		label: 'はげまし',
		icon: '💬',
		items: [
			{ href: `${basePath}/points`, label: 'ポイント', icon: '⭐' },
			{ href: `${basePath}/messages`, label: 'おうえん', icon: '💌' },
			{ href: `${basePath}/rewards`, label: 'ごほうび', icon: '🎁' },
		],
	},
	{
		id: 'customize',
		label: 'カスタマイズ',
		icon: '🎮',
		items: [
			{ href: `${basePath}/activities`, label: '活動管理', icon: '📋' },
			{ href: `${basePath}/checklists`, label: 'チェックリスト', icon: '✅' },
			{ href: `${basePath}/events`, label: 'イベント', icon: '🎉' },
			{ href: `${basePath}/challenges`, label: 'チャレンジ', icon: '👥' },
		],
	},
	{
		id: 'settings',
		label: '設定',
		icon: '⚙️',
		items: [
			{ href: `${basePath}/children`, label: 'こども', icon: '👧' },
			{ href: `${basePath}/settings`, label: 'アカウント', icon: '⚙️' },
			{ href: `${basePath}/license`, label: 'プラン', icon: '💎' },
			{ href: `${basePath}/members`, label: 'メンバー', icon: '👥' },
		],
	},
]);

// Current active category based on URL
const activeCategoryId = $derived.by(() => {
	const path = $page.url.pathname;
	for (const cat of navCategories) {
		for (const item of cat.items) {
			if (path.startsWith(item.href)) return cat.id;
		}
	}
	return null;
});

// Mobile: expanded category submenu
let mobileExpandedCategory = $state<string | null>(null);

function handleMobileCategoryClick(categoryId: string) {
	if (mobileExpandedCategory === categoryId) {
		mobileExpandedCategory = null;
	} else {
		mobileExpandedCategory = categoryId;
	}
}

// Close mobile submenu on navigation
$effect(() => {
	$page.url.pathname;
	mobileExpandedCategory = null;
});

// Desktop: expanded dropdown
let desktopExpandedCategory = $state<string | null>(null);
let dropdownCloseTimer: ReturnType<typeof setTimeout> | null = null;

function handleDesktopCategoryEnter(categoryId: string) {
	if (dropdownCloseTimer) {
		clearTimeout(dropdownCloseTimer);
		dropdownCloseTimer = null;
	}
	desktopExpandedCategory = categoryId;
}

function handleDesktopCategoryLeave() {
	dropdownCloseTimer = setTimeout(() => {
		desktopExpandedCategory = null;
	}, 150);
}

function isItemActive(itemHref: string): boolean {
	return $page.url.pathname.startsWith(itemHref);
}
</script>

<div data-theme="admin" data-plan={planTier} class="admin-shell">
	<!-- Admin Header -->
	<header class="admin-header sticky {isDemo ? 'top-10' : 'top-0'} z-30 backdrop-blur border-b border-[var(--color-border-default)] px-4 py-3">
		<div class="max-w-4xl mx-auto flex items-center justify-between">
			<div class="flex items-center gap-2">
				<a href={basePath} class="flex items-center">
					<Logo variant="compact" size={120} planTier={isPremium ? planTier : undefined} />
				</a>
				<span class="text-xs font-medium text-[var(--color-text-muted)] border border-[var(--color-border-strong)] rounded px-1.5 py-0.5">管理</span>
				{#if isDemo}
					<span class="text-xs font-medium text-[var(--color-warning)] border border-[var(--color-feedback-warning-border)] rounded px-1.5 py-0.5">デモ</span>
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
						class="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--color-feedback-info-bg-strong)] text-[var(--color-brand-600)] hover:brightness-95 transition-all text-sm font-bold"
						title="チュートリアルを開始"
						data-tutorial="tutorial-restart"
						type="button"
					>
						?
					</button>
				{/if}
				<a
					href={isDemo ? '/demo' : '/switch'}
					class="text-sm px-3 py-1 bg-[var(--color-surface-muted-strong)] text-[var(--color-text-muted)] rounded-lg hover:bg-[var(--color-neutral-200)] transition-colors inline-flex items-center gap-1"
					data-tutorial="switch-to-child"
				>
					<span aria-hidden="true">&larr;</span>
					{isDemo ? 'デモトップ' : '子供画面へ'}
				</a>
			</div>
		</div>
	</header>

	<!-- Desktop Navigation (>=768px) — 4カテゴリ + ドロップダウン -->
	<nav class="hidden md:block bg-[var(--color-surface-card)] border-b border-[var(--color-border-default)] px-4 py-2" aria-label="管理メニュー" data-tutorial="nav-desktop">
		<div class="max-w-4xl mx-auto flex gap-1">
			{#each navCategories as category}
				{@const isActive = activeCategoryId === category.id}
				<div
					class="relative"
					role="none"
					onmouseenter={() => handleDesktopCategoryEnter(category.id)}
					onmouseleave={handleDesktopCategoryLeave}
				>
					<button
						type="button"
						class="nav-item {isActive ? 'nav-item--active' : ''}"
						aria-expanded={desktopExpandedCategory === category.id}
						aria-haspopup="true"
						onclick={() => handleDesktopCategoryEnter(category.id)}
					>
						<span aria-hidden="true">{category.icon}</span>
						{category.label}
						<span class="text-[10px] ml-0.5 opacity-50" aria-hidden="true">▾</span>
					</button>
					{#if desktopExpandedCategory === category.id}
						<div
							class="desktop-dropdown"
							role="menu"
							onmouseenter={() => handleDesktopCategoryEnter(category.id)}
							onmouseleave={handleDesktopCategoryLeave}
						>
							{#each category.items as item}
								<a
									href={item.href}
									class="dropdown-item {isItemActive(item.href) ? 'dropdown-item--active' : ''}"
									role="menuitem"
								>
									<span aria-hidden="true">{item.icon}</span>
									{item.label}
								</a>
							{/each}
						</div>
					{/if}
				</div>
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

	<!-- Mobile Bottom Navigation (<768px) — 4カテゴリ -->
	<nav class="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[var(--color-surface-card)] border-t border-[var(--color-border-default)] safe-area-bottom" aria-label="メインナビゲーション" data-tutorial="nav-primary">
		<!-- Expanded submenu panel -->
		{#if mobileExpandedCategory}
			{@const expandedCat = navCategories.find((c) => c.id === mobileExpandedCategory)}
			{#if expandedCat}
				<!-- Backdrop -->
				<button
					type="button"
					class="fixed inset-0 z-[-1]"
					onclick={() => (mobileExpandedCategory = null)}
					aria-label="メニューを閉じる"
				></button>
				<div class="mobile-submenu">
					<div class="text-xs font-bold text-[var(--color-text-muted)] mb-2 px-1">{expandedCat.label}</div>
					<div class="grid grid-cols-3 gap-2">
						{#each expandedCat.items as item}
							<a
								href={item.href}
								class="mobile-submenu-item {isItemActive(item.href) ? 'mobile-submenu-item--active' : ''}"
							>
								<span class="text-lg" aria-hidden="true">{item.icon}</span>
								<span class="text-[10px] font-medium leading-tight text-center">{item.label}</span>
							</a>
						{/each}
					</div>
				</div>
			{/if}
		{/if}

		<!-- Category buttons -->
		<div class="flex justify-around items-center h-16">
			{#each navCategories as category}
				{@const isActive = activeCategoryId === category.id}
				<button
					type="button"
					class="mobile-nav-item {isActive ? 'mobile-nav-item--active' : ''} {mobileExpandedCategory === category.id ? 'mobile-nav-item--expanded' : ''}"
					onclick={() => handleMobileCategoryClick(category.id)}
					aria-expanded={mobileExpandedCategory === category.id}
					aria-haspopup="true"
				>
					<span class="text-xl" aria-hidden="true">{category.icon}</span>
					<span class="text-[10px] font-medium leading-none">{category.label}</span>
				</button>
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
	/* Desktop nav — category buttons */
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
		cursor: pointer;
		border: none;
		background: none;
	}
	.nav-item:hover {
		background: var(--plan-nav-bg, #e8f4fd);
		color: var(--plan-nav-text, var(--color-brand-600));
	}
	.nav-item--active {
		background: var(--plan-nav-active, #dbeafe);
		color: var(--plan-nav-text, var(--color-brand-700));
	}
	/* Desktop dropdown */
	.desktop-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		min-width: 180px;
		background: white;
		border: 1px solid var(--color-border, #e5e7eb);
		border-radius: 0.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		padding: 0.25rem;
		z-index: 50;
		margin-top: 0.25rem;
	}
	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary, #4b5563);
		transition: all 0.1s;
		white-space: nowrap;
	}
	.dropdown-item:hover {
		background: var(--plan-nav-bg, #e8f4fd);
		color: var(--plan-nav-text, var(--color-brand-600));
	}
	.dropdown-item--active {
		background: var(--plan-nav-active, #dbeafe);
		color: var(--plan-nav-text, var(--color-brand-700));
		font-weight: 600;
	}
	/* Mobile nav — category buttons */
	.mobile-nav-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		width: 4.5rem;
		height: 100%;
		transition: color 0.15s;
		color: var(--color-text-tertiary, #9ca3af);
		border: none;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	.mobile-nav-item:hover {
		color: var(--color-text-secondary, #4b5563);
	}
	.mobile-nav-item--active {
		color: var(--plan-primary, var(--color-brand-600));
	}
	.mobile-nav-item--expanded {
		color: var(--plan-primary, var(--color-brand-600));
	}
	/* Mobile submenu panel */
	.mobile-submenu {
		background: white;
		border-top: 1px solid var(--color-border, #e5e7eb);
		padding: 12px 16px;
		animation: slideUp 0.15s ease-out;
	}
	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.mobile-submenu-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 10px 4px;
		border-radius: 0.5rem;
		color: var(--color-text-secondary, #4b5563);
		transition: all 0.1s;
	}
	.mobile-submenu-item:hover {
		background: var(--plan-nav-bg, #e8f4fd);
	}
	.mobile-submenu-item--active {
		background: var(--plan-nav-active, #dbeafe);
		color: var(--plan-nav-text, var(--color-brand-700));
		font-weight: 600;
	}
</style>
