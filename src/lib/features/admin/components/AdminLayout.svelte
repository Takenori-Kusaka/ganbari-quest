<script lang="ts">
import type { Snippet } from 'svelte';
import { navigating, page } from '$app/stores';
import {
	FEATURES_LABELS,
	NAV_CATEGORIES,
	NAV_ITEM_LABELS,
	PLAN_LABELS,
	TRIAL_LABELS,
} from '$lib/domain/labels';
import Logo from '$lib/ui/components/Logo.svelte';
import PageGuideOverlay from '$lib/ui/components/PageGuideOverlay.svelte';
import TutorialOverlay from '$lib/ui/components/TutorialOverlay.svelte';
import {
	filterGuideStepsByRuntime,
	filterGuideStepsByStripe,
	filterGuideStepsByTier,
	getPageGuide,
} from '$lib/ui/tutorial/page-guide-registry';
import { startPageGuide } from '$lib/ui/tutorial/page-guide-store.svelte';
// #2375: v1 PageHelpButton + handleStartTutorial fallback 撤去 (P4)。
// AC-V2-5 のため v2 PageGuide 起動時に v1 tutorial を強制終了する目的で endTutorial のみ import。
import { endTutorial } from '$lib/ui/tutorial/tutorial-store.svelte';

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
	/** #2198: Multi-Lambda demo deployment (`AUTH_MODE=anonymous`) — upgrade CTA / plan badge を抑止する。
	 *   LP SS carousel-4 で「demo なのにアップグレード強要」訴求毀損を防ぐ (ADR-0048 §決定 P-1.8 整合)。 */
	authMode?: string;
	/** #3033: trial active 中のみ残日数 (null = trial 非 active で pill 非表示) */
	trialDaysRemaining?: number | null;
	/** #3291: ADR-0040 実行モード (`locals.runtimeMode` 由来)。NUC セルフホスト版で
	 *   SaaS 専用ガイド手順 (requiredRuntime='saas') を除外するために使う。 */
	runtimeMode?: string;
	/** #3296: Stripe 決済の有効性 (`isStripeEnabled()` 由来、`+layout.server.ts` が配布)。
	 *   Stripe 無効時に `requiredStripe='enabled'` ガイド手順 (プラン管理 spotlight) を除外する。 */
	stripeEnabled?: boolean;
}

let {
	children,
	mode,
	basePath,
	isPremium = false,
	planTier = 'free',
	authMode,
	trialDaysRemaining = null,
	runtimeMode,
	stripeEnabled,
}: Props = $props();

const isDemo = $derived(mode === 'demo');
const isAnonymousLambda = $derived(authMode === 'anonymous');

// #2375: ページガイド（v2）— v1 PageHelpButton + handleStartTutorial fallback を撤去 (P4)。
// 旧 fallback は header の `?` ボタン (Button + handleStartTutorial) で、PageGuideRegistry 未登録ページのみ
// 別経路 (startTutorialForPage) を呼んでいた。本撤去後は ❓ (v2) のみが唯一の経路。
// 未登録ページでは ❓ ボタン自体を非表示にする (全 admin ページは _guide.ts を持つ規約、page-guide-registry.ts SSOT)。
// #2109: 赤バッジ (page-guide-badge) 撤廃 → pageGuideCompleted state 不要化 (ADR-0012 anti-engagement)
let hasPageGuide = $state(false);

$effect(() => {
	const path = $page.url.pathname;
	hasPageGuide = false;

	const adminPath = path.replace(basePath, '/admin');
	getPageGuide(adminPath).then((guide) => {
		// #2919: requiredTier フィルタ後に手順が 1 つも残らないページでは ❓ を出さない
		// (空ガイドを開くと dead-end になるため)。現状 challenges は free でも非 gate 手順が
		// 1 つ残るため button は維持されるが、将来 family 限定手順のみのページが追加されても
		// 自動で button が抑止される。
		// #3291 / #3296: tier → runtime → stripe の 3 フィルタを直列適用し、全手順が除外される
		// ページ (残 0) では ❓ を抑止する。3 者は filter → 残 0 なら null で同型・直列適用可。
		const tierFiltered = guide === null ? null : filterGuideStepsByTier(guide, planTier);
		const runtimeFiltered =
			tierFiltered === null ? null : filterGuideStepsByRuntime(tierFiltered, runtimeMode);
		hasPageGuide =
			runtimeFiltered !== null && filterGuideStepsByStripe(runtimeFiltered, stripeEnabled) !== null;
	});
});

async function handleStartPageGuide() {
	// #2375 AC-V2-5: v1 tutorial (AdminHome banner 経由) を強制終了し、v1/v2 同時 active を防止
	endTutorial();
	const path = $page.url.pathname.replace(basePath, '/admin');
	const guide = await getPageGuide(path);
	if (!guide) return;
	// #2919: 現在のプランで表示できない手順 (requiredTier 未達、例: challenges-intro の family)
	// を除外してから起動する。free ユーザーに「上位プラン限定」の手順を見せない (NN/G #1 / #5)。
	// #3291: NUC では SaaS 専用手順 (requiredRuntime='saas') も除外してから起動する。
	// #3296: Stripe 無効時は requiredStripe='enabled' 手順 (プラン管理 spotlight) も除外する。
	const tierFiltered = filterGuideStepsByTier(guide, planTier);
	const runtimeFiltered =
		tierFiltered === null ? null : filterGuideStepsByRuntime(tierFiltered, runtimeMode);
	const filtered =
		runtimeFiltered === null ? null : filterGuideStepsByStripe(runtimeFiltered, stripeEnabled);
	if (filtered) {
		startPageGuide(filtered);
	}
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
	if (planTier === 'family') return PLAN_LABELS.family;
	if (planTier === 'standard') return PLAN_LABELS.standard;
	return '';
});

// #2178 (EPIC #2176 / admin-ia.md v2.0): 5 tab 構成 (ホーム + 家族 + 活動 + 記録 + 設定)。
// こども・メンバーを family カテゴリに移動 (subject-first 上位化、Family Link 流)。
const navCategories: NavCategory[] = $derived([
	{
		id: 'family',
		label: NAV_CATEGORIES.family.label,
		icon: NAV_CATEGORIES.family.icon,
		items: [
			{ href: `${basePath}/children`, label: NAV_ITEM_LABELS.children, icon: '👧' },
			{ href: `${basePath}/members`, label: NAV_ITEM_LABELS.members, icon: '👥' },
		],
	},
	{
		id: 'activity',
		label: NAV_CATEGORIES.activity.label,
		icon: NAV_CATEGORIES.activity.icon,
		items: [
			{ href: `${basePath}/activities`, label: NAV_ITEM_LABELS.activities, icon: '📋' },
			{ href: `${basePath}/checklists`, label: NAV_ITEM_LABELS.checklists, icon: '✅' },
			// #2295 (EPIC #2294 ①): events 削除済 (2026-05-19)
			{ href: `${basePath}/challenges`, label: NAV_ITEM_LABELS.challenges, icon: '👥' },
			// #2274 (EPIC #2266): ごほうび/応援を record→activity 配下に移動
			// (rewards/cheer は日々の活動なので activity タブ配下が適切、PO 指摘 2026-05-19)
			{ href: `${basePath}/rewards`, label: NAV_ITEM_LABELS.rewards, icon: '🎁' },
			{ href: `${basePath}/cheer`, label: NAV_ITEM_LABELS.cheer, icon: '🎉' },
			// #1170: マケプレをグローバルナビ昇格（activity の一員として導線短縮）
			{ href: '/marketplace', label: NAV_ITEM_LABELS.marketplace, icon: '🛍️' },
			// #2178: こども → family カテゴリへ移動済
		],
	},
	{
		id: 'record',
		label: NAV_CATEGORIES.record.label,
		icon: NAV_CATEGORIES.record.icon,
		items: [
			{ href: `${basePath}/reports`, label: NAV_ITEM_LABELS.reports, icon: '📊' },
			{ href: `${basePath}/growth-book`, label: NAV_ITEM_LABELS.growthBook, icon: '📚' },
			// #1782: 「実績」ナビ削除。チャレンジ機能 (/admin/challenges) に統合 (ADR-0012 §6 整合)
			// #2284 (EPIC #2283): /admin/analytics 撤去。運用者向け機能は /ops/analytics に移動
			{ href: `${basePath}/points`, label: NAV_ITEM_LABELS.points, icon: '⭐' },
			// #2270 / #2274 (EPIC #2266): messages 廃止 + rewards/cheer を activity 配下に移動
		],
	},
	{
		id: 'settings',
		label: NAV_CATEGORIES.settings.label,
		icon: NAV_CATEGORIES.settings.icon,
		items: [
			{ href: `${basePath}/settings`, label: NAV_ITEM_LABELS.settings, icon: '⚙️' },
			{ href: `${basePath}/subscription`, label: NAV_ITEM_LABELS.license, icon: '💎' },
			{ href: `${basePath}/billing`, label: NAV_ITEM_LABELS.billing, icon: '🧾' },
			// #2178: メンバー → family カテゴリへ移動済
		],
	},
]);

// Current active category based on URL
const activeCategoryId = $derived.by(() => {
	const path = $page.url.pathname;
	// ホームページ（/admin または /demo/admin 等 basePath と完全一致）は 'home' として判定
	if (path === basePath || path === `${basePath}/`) return 'home';
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
				<!-- #3033: スマホは symbol (アイコンのみ) で header 領域を確保し trial pill 等の優先要素を残す -->
				<a href={basePath} class="flex items-center">
					<span class="hidden md:inline-flex"><Logo variant="compact" size={140} /></span>
					<span class="inline-flex md:hidden"><Logo variant="symbol" size={44} /></span>
				</a>
				{#if isDemo}
					<span class="header-badge header-badge--demo">{FEATURES_LABELS.adminLayout.demoBadge}</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if !isDemo && !isAnonymousLambda && trialDaysRemaining !== null}
					<!-- #3033: trial active 中の残日数 pill (Buffer 型)。tap でプランページへ -->
					<a
						href="{basePath}/subscription"
						class="trial-pill"
						data-testid="header-trial-pill"
						title={TRIAL_LABELS.headerPillTitle}
					>
						⭐ {TRIAL_LABELS.headerPillLabel(trialDaysRemaining)}
					</a>
				{/if}
				{#if !isDemo && !isAnonymousLambda && !isPremium}
					<a
						href="{basePath}/subscription"
						class="upgrade-btn"
						data-tutorial="upgrade-btn"
					>
						{FEATURES_LABELS.adminLayout.upgradeBtn}
					</a>
				{:else if !isDemo && !isAnonymousLambda && isPremium}
					<a href="{basePath}/subscription" class="plan-badge plan-badge--{planTier}">{planLabel}</a>
				{/if}
				{#if !isDemo && hasPageGuide}
					<button
						onclick={handleStartPageGuide}
						class="page-guide-btn"
						title={FEATURES_LABELS.adminLayout.pageGuideTitle}
						data-tutorial="page-guide-btn"
						type="button"
					>
						❓
					</button>
				{/if}
				<a
					href={isDemo ? '/demo' : '/switch'}
					class="header-switch-link"
					data-tutorial="switch-to-child"
				>
					<span aria-hidden="true">&larr;</span>
					{isDemo ? FEATURES_LABELS.adminLayout.demoTopLink : FEATURES_LABELS.adminLayout.switchToChild}
				</a>
			</div>
		</div>
	</header>

	<!-- Desktop Navigation (>=768px) — ホーム + 4カテゴリ (家族/活動/記録/設定) + ドロップダウン (#2178) -->
	<nav class="hidden md:block bg-[var(--color-surface-card)] border-b border-[var(--color-border-default)] px-4 py-2" aria-label={FEATURES_LABELS.adminLayout.desktopNavAriaLabel} data-tutorial="nav-desktop">
		<div class="max-w-4xl mx-auto flex gap-1">
			<!-- ホームリンク（dropdown なし） -->
			<a
				href={basePath}
				class="nav-item {activeCategoryId === 'home' ? 'nav-item--active' : ''}"
			>
				<span aria-hidden="true">🏠</span>
				{NAV_ITEM_LABELS.home}
			</a>
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
							tabindex="-1"
							onmouseenter={() => handleDesktopCategoryEnter(category.id)}
							onmouseleave={handleDesktopCategoryLeave}
						>
							{#each category.items as item}
								<a
									href={item.href}
									class="dropdown-item {isItemActive(item.href) ? 'dropdown-item--active' : ''}"
									role="menuitem"
									data-testid={item.href === '/marketplace' ? 'nav-marketplace' : undefined}
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

	<!-- Mobile Bottom Navigation (<768px) — 5 tab (ホーム + 家族/活動/記録/設定) (#2178) -->
	<nav class="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[var(--color-surface-card)] border-t border-[var(--color-border-default)] safe-area-bottom" aria-label={FEATURES_LABELS.adminLayout.mobileNavAriaLabel} data-tutorial="nav-primary">
		<!-- Expanded submenu panel -->
		{#if mobileExpandedCategory}
			{@const expandedCat = navCategories.find((c) => c.id === mobileExpandedCategory)}
			{#if expandedCat}
				<!-- Backdrop -->
				<button
					type="button"
					class="fixed inset-0 z-[-1]"
					onclick={() => (mobileExpandedCategory = null)}
					aria-label={FEATURES_LABELS.adminLayout.mobileMenuCloseAriaLabel}
				></button>
				<div class="mobile-submenu">
					<div class="mobile-submenu-label">{expandedCat.label}</div>
					<div class="grid grid-cols-3 gap-2">
						{#each expandedCat.items as item}
							<a
								href={item.href}
								class="mobile-submenu-item {isItemActive(item.href) ? 'mobile-submenu-item--active' : ''}"
								data-testid={item.href === '/marketplace' ? 'nav-marketplace-mobile' : undefined}
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
			<!-- ホームボタン（dropdown なし） -->
			<a
				href={basePath}
				class="mobile-nav-item {activeCategoryId === 'home' ? 'mobile-nav-item--active' : ''}"
				onclick={() => (mobileExpandedCategory = null)}
			>
				<span class="text-xl" aria-hidden="true">🏠</span>
				<span class="text-[10px] font-medium leading-none">{NAV_ITEM_LABELS.home}</span>
			</a>
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
		<PageGuideOverlay />
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
	/* Header badges — parent / demo labels */
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
	/* Trial countdown pill (#3033) — visible only while trial is active, same tokens as TrialBanner */
	.trial-pill {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 4px 10px;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--color-text-inverse);
		background: var(--color-action-trial);
		border-radius: var(--radius-full);
		text-decoration: none;
		white-space: nowrap;
		transition: background 0.15s ease;
	}
	.trial-pill:hover {
		background: var(--color-action-trial-hover);
	}
	/* Plan badge — single instance (#490), linked to the subscription page (#3033) */
	.plan-badge {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 3px 10px;
		font-size: 0.7rem;
		font-weight: 700;
		border-radius: 9999px;
		white-space: nowrap;
		text-decoration: none;
	}
	.plan-badge--standard {
		background: var(--plan-badge-bg, #f3e8ff);
		color: var(--plan-badge-text, #6d28d9);
	}
	.plan-badge--family {
		background: var(--plan-badge-bg, #fef3c7);
		color: var(--plan-badge-text, #92400e);
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
		/* DESIGN section 10 z-index token (#2258 / EPIC #2253): raw 50 -> var(--z-modal) */
		z-index: var(--z-modal);
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
	/* Mobile nav — category buttons (#2178: 5-tab width tightened 4.5rem -> 3.75rem to fit iPhone SE 375px) */
	.mobile-nav-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		width: 3.75rem;
		height: 100%;
		transition: color 0.15s;
		color: var(--color-text-tertiary, #9ca3af);
		border: none;
		background: none;
		cursor: pointer;
		padding: 0 2px;
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
	/* Page Guide help button */
	.page-guide-btn {
		/* #2109: position: relative removed (was only needed for now-deleted .page-guide-badge absolute positioning) */
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		background: var(--color-surface-card, #e0f2fe);
		border: 2px solid var(--color-action-primary, #3b82f6);
		cursor: pointer;
		font-size: 0.875rem;
		transition: all 0.15s;
	}
	.page-guide-btn:hover {
		background: var(--color-action-primary, #3b82f6);
		filter: brightness(1.1);
	}
	/* #2109: .page-guide-badge (red --color-danger notification dot) removed
	   ADR-0012 anti-engagement + industry prior art (Linear / Notion / GitHub / Stripe / Sentry) */
</style>
