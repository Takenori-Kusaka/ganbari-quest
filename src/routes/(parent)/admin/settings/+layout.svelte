<script lang="ts">
// #2320 (EPIC #2319 ①): /admin/settings 配下のサブナビ統合 layout。
// Settings 6 グループ (account / activities / notifications / data / support + plan deep link)
// への遷移を提供。Material Design / Apple HIG / NN/G Common Region 原則 + GitHub
// (organization > repo > personal 3 階層) prior art 整合。
//
// AdminLayout は触らない (settings 専用 +layout で完結、影響範囲を局所化)。

import type { Snippet } from 'svelte';
import { page } from '$app/stores';
import { SETTINGS_NAV_LABELS } from '$lib/domain/labels';

interface Props {
	children: Snippet;
}

let { children }: Props = $props();

interface NavItem {
	href: string;
	label: string;
	icon: string;
	/** 外部リンク (settings 配下ではないが導線として併設) */
	external?: boolean;
}

const navItems: NavItem[] = [
	{ href: '/admin/settings', label: SETTINGS_NAV_LABELS.hub, icon: '🏠' },
	{ href: '/admin/settings/account', label: SETTINGS_NAV_LABELS.account, icon: '🔑' },
	{
		href: '/admin/settings/activities',
		label: SETTINGS_NAV_LABELS.activities,
		icon: '🎯',
	},
	{
		href: '/admin/settings/notifications',
		label: SETTINGS_NAV_LABELS.notifications,
		icon: '🔔',
	},
	{ href: '/admin/settings/data', label: SETTINGS_NAV_LABELS.data, icon: '💾' },
	{ href: '/admin/settings/support', label: SETTINGS_NAV_LABELS.support, icon: '💬' },
	{
		href: '/admin/license',
		label: SETTINGS_NAV_LABELS.plan,
		icon: '💎',
		external: true,
	},
];

function isActive(item: NavItem): boolean {
	const path = $page.url.pathname;
	if (item.href === '/admin/settings') {
		return path === '/admin/settings' || path === '/admin/settings/';
	}
	return path.startsWith(item.href);
}
</script>

<nav
	class="settings-subnav"
	aria-label={SETTINGS_NAV_LABELS.ariaLabel}
	data-testid="settings-subnav"
>
	<ul class="settings-subnav__list">
		{#each navItems as item (item.href)}
			<li class="settings-subnav__item">
				<a
					href={item.href}
					class="settings-subnav__link"
					class:settings-subnav__link--active={isActive(item)}
					aria-current={isActive(item) ? 'page' : undefined}
					data-testid="settings-subnav-{item.label}"
				>
					<span aria-hidden="true">{item.icon}</span>
					<span class="settings-subnav__label">{item.label}</span>
					{#if item.external}
						<span class="settings-subnav__external" aria-label="別ページ">↗</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<div class="settings-content">
	{@render children()}
</div>

<style>
	.settings-subnav {
		margin-bottom: 1rem;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
		border-radius: 0.75rem;
		padding: 0.5rem;
	}

	.settings-subnav__list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.settings-subnav__item {
		flex: 1 1 auto;
		min-width: 0;
	}

	.settings-subnav__link {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-decoration: none;
		transition: background-color 0.15s ease, color 0.15s ease;
		white-space: nowrap;
	}

	.settings-subnav__link:hover {
		background: var(--color-surface-muted);
		color: var(--color-text-primary);
	}

	.settings-subnav__link--active {
		background: var(--color-feedback-info-bg);
		color: var(--color-text-link);
		font-weight: 600;
	}

	.settings-subnav__external {
		font-size: 0.75rem;
		opacity: 0.6;
	}

	@media (max-width: 640px) {
		.settings-subnav__list {
			overflow-x: auto;
			flex-wrap: nowrap;
			-webkit-overflow-scrolling: touch;
		}

		.settings-subnav__item {
			flex: 0 0 auto;
		}

		.settings-subnav__label {
			font-size: 0.8125rem;
		}
	}
</style>
