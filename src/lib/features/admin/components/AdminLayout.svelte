<script lang="ts">
import type { Snippet } from 'svelte';
import { navigating, page } from '$app/stores';
import { PLAN_LABELS } from '$lib/domain/labels';
import Logo from '$lib/ui/components/Logo.svelte';
import TutorialOverlay from '$lib/ui/components/TutorialOverlay.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import { markTutorialStarted, startTutorialForPage } from '$lib/ui/tutorial/tutorial-store.svelte';

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
	const currentPath = $page.url.pathname;
	await startTutorialForPage(currentPath);
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

/** Full plan name for the header badge (#490) */
const planLabel = $derived.by(() => {
	if (planTier === 'free') return '';
	return PLAN_LABELS[planTier] ?? '';
});

const navCategories: NavCategory[] = $derived([
	{
		id: 'monitor',
		label: '記録・分析',
		icon: '📊',
		items: [
			{ href: `${basePath}/reports`, label: 'レポート', icon: '📊' },
			{ href: `${basePath}/growth-book`, label: 'グロースブック', icon: '📚' },
			{ href: `${basePath}/achievements`, label: 'チャレンジ履歴', icon: '🏅' },
		],
	},
	{
		id: 'encourage',
		label: '応援・報酬',
		icon: '💬',
		items: [
			{ href: `${basePath}/points`, label: 'ポイント', icon: '⭐' },
			{ href: `${basePath}/messages`, label: 'おうえん', icon: '💌' },
			{ href: `${basePath}/rewards`, label: 'ごほうび', icon: '🎁' },
		],
	},
	{
		id: 'customize',
		label: '活動設定',
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
		label: 'アカウント',
		icon: '⚙️',
		items: [
			{ href: `${basePath}/children`, label: 'こども', icon: '👧' },
			{ href: `${basePath}/settings`, label: '設定', icon: '⚙️' },
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
					<Logo variant="compact" size={120} />
				</a>
				<span class="header-badge header-badge--admin">保護者用</span>
				{#if isDemo}
					<span class="header-badge header-badge--demo">デモ</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if !isDemo && !isPremium}
					<a
						href="{basePath}/license"
						class="upgrade-btn"
						data-tutorial="upgrade-btn"
					>
						アップグレード
					</a>
				{:else if !isDemo && isPremium}
					<span class="plan-badge plan-badge--{planTier}">{planLabel}</span>
				{/if}
				{#if !isDemo}
					<Button
						variant="ghost"
						size="sm"
						onclick={handleStartTutorial}
						title="チュートリアルを開始"
						data-tutorial="tutorial-restart"
						class="header-tutorial-btn"
					>
						?
					</Button>
				{/if}
				<a
					href={isDemo ? '/demo' : '/switch'}
					class="header-switch-link"
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
					<div class="mobile-submenu-label">{expandedCat.label}</div>
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
	/* Header badges — "保護者用" / "デモ" */
	.header-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 600;
		border-radius: var(--radius-sm, 0.25rem);
		white-space: nowrap;
	}
	.header-badge--admin {
		color: var(--color-brand-700);
		background: var(--color-brand-100);
	}
	.header-badge--demo {
		color: var(--color-warning);
		background: color-mix(in srgb, var(--color-warning) 15%, transparent);
	}
	/* Upgrade link */
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
		color: var(--color-text-inverse);
	}
	/* Plan badge — single instance (#490) */
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
	/* Tutorial button override for small size (#497) */
	:global(.header-tutorial-btn) {
		width: 2rem !important;
		height: 2rem !important;
		min-height: unset !important;
		padding: 0 !important;
		border-radius: var(--radius-full) !important;
		font-weight: 700 !important;
	}
	/* Switch link (#497) — uses CSS variables instead of Tailwind colors */
	.header-switch-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.75rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		background: var(--color-surface-muted);
		border-radius: var(--radius-md, 0.5rem);
		transition: background 0.15s ease;
		text-decoration: none;
		white-space: nowrap;
	}
	.header-switch-link:hover {
		background: var(--color-border-default);
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
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
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
		background: var(--color-surface-card);
		border-top: 1px solid var(--color-border-default);
		padding: 12px 16px;
		animation: slideUp 0.15s ease-out;
	}
	.mobile-submenu-label {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
		padding-left: 0.25rem;
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
