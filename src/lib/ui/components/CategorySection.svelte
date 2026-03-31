<script lang="ts">
import { CARD_SIZE_CSS, type CardSize } from '$lib/domain/display-config';
import { getCategoryById } from '$lib/domain/validation/activity';
import type { Snippet } from 'svelte';

interface CategoryXpInfo {
	value: number;
	level: number;
	levelTitle: string;
	expToNextLevel: number;
	maxValue: number;
	progressPct?: number;
}

interface Props {
	categoryId: number;
	cardSize?: CardSize;
	itemsPerCategory?: number;
	collapsible?: boolean;
	compactMode?: boolean;
	itemCount?: number;
	xpInfo?: CategoryXpInfo | null;
	xpAnimating?: boolean;
	missionCount?: number;
	completedMissionCount?: number;
	children: Snippet;
}

let {
	categoryId,
	cardSize = 'medium',
	itemsPerCategory = 0,
	collapsible = false,
	compactMode = false,
	itemCount = 0,
	xpInfo = null,
	xpAnimating = false,
	missionCount = 0,
	completedMissionCount = 0,
	children,
}: Props = $props();

const catDef = $derived(getCategoryById(categoryId));
const color = $derived(catDef?.color ?? 'var(--theme-primary)');
const accent = $derived(catDef?.accent ?? color);
const name = $derived(catDef?.name ?? '');
const icon = $derived(catDef?.icon ?? '');

const css = $derived(CARD_SIZE_CSS[cardSize]);
const gridStyle = $derived(
	`grid-template-columns: repeat(auto-fill, minmax(${css.minWidth}, 1fr));`,
);

// Collapsible state
let expanded = $state(!compactMode);
const shouldCollapse = $derived(
	collapsible && itemsPerCategory > 0 && itemCount > itemsPerCategory,
);
const ROW_HEIGHTS: Record<CardSize, number> = { small: 90, medium: 120, large: 160 };
const MIN_COLS: Record<CardSize, number> = { small: 4, medium: 3, large: 2 };
const collapsedRows = $derived(Math.ceil(itemsPerCategory / MIN_COLS[cardSize]));
const collapsedMaxHeight = $derived(`${collapsedRows * ROW_HEIGHTS[cardSize]}px`);

/** レベル内のXP進捗率（0〜100%） */
function xpBarPct(xp: CategoryXpInfo): number {
	return xp.progressPct ?? 0;
}

function toggleExpand() {
	expanded = !expanded;
}
</script>

<section class="mb-[var(--sp-sm)]">
	<!-- Category header (always visible) -->
	<button
		class="flex items-center gap-1 mb-1 px-1 w-full text-left"
		onclick={toggleExpand}
		data-testid="category-header-{categoryId}"
	>
		{#if compactMode}
			<span class="text-xl">{icon}</span>
		{/if}
		<h2 class="flex items-center gap-1">
			<span
				class="w-1 h-4 rounded-[var(--radius-full)]"
				style="background-color: {accent};"
				aria-hidden="true"
			></span>
			<span class="text-xs font-bold text-[var(--color-text-muted)]">{name}</span>
		</h2>
		{#if missionCount > 0}
			<span class="text-[10px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
				{completedMissionCount}/{missionCount}
			</span>
		{/if}
		{#if xpInfo}
			<span class="text-[10px] font-bold" style="color: {accent};">Lv.{xpInfo.level}</span>
			<div class="w-24 h-2.5 rounded-full bg-gray-200 overflow-hidden ml-auto" data-testid="xp-bar-{categoryId}" role="progressbar" aria-valuenow={Math.round(xpBarPct(xpInfo))} aria-valuemin={0} aria-valuemax={100}>
				<div
					class="h-full rounded-full xp-bar__fill"
					class:xp-bar--animating={xpAnimating}
					style="width: {xpBarPct(xpInfo)}%; background-color: {accent};"
				></div>
			</div>
			<span class="text-[10px] text-[var(--color-text-muted)] tabular-nums w-8 text-right">{Math.round(xpBarPct(xpInfo))}%</span>
		{/if}
		{#if compactMode}
			<span class="text-xs text-[var(--color-text-muted)] ml-1">{expanded ? '▲' : '▼'}</span>
		{/if}
	</button>

	<!-- Activity grid (expandable in compact mode) -->
	{#if expanded}
		<div
			class="grid gap-1 px-1"
			class:collapsed={shouldCollapse && !expanded}
			style="{gridStyle}{shouldCollapse && !expanded ? ` max-height: ${collapsedMaxHeight}; overflow: hidden;` : ''}"
		>
			{@render children()}
		</div>
		{#if shouldCollapse}
			<button
				class="w-full py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
				onclick={() => (expanded = !expanded)}
			>
				{expanded ? '▲ たたむ' : `▼ もっとみる（のこり ${itemCount - itemsPerCategory}こ）`}
			</button>
		{/if}
	{/if}
</section>

<style>
	.collapsed {
		position: relative;
	}
	.collapsed::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 24px;
		background: linear-gradient(transparent, white);
		pointer-events: none;
	}
	.xp-bar__fill {
		transition: width 0.3s ease-out;
	}
	.xp-bar--animating {
		transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
	}
	@media (prefers-reduced-motion: reduce) {
		.xp-bar__fill,
		.xp-bar--animating {
			transition: none;
		}
	}
</style>
