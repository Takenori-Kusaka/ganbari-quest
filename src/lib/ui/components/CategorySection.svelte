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
}

interface Props {
	categoryId: number;
	cardSize?: CardSize;
	itemsPerCategory?: number;
	collapsible?: boolean;
	itemCount?: number;
	xpInfo?: CategoryXpInfo | null;
	xpAnimating?: boolean;
	children: Snippet;
}

let {
	categoryId,
	cardSize = 'medium',
	itemsPerCategory = 0,
	collapsible = false,
	itemCount = 0,
	xpInfo = null,
	xpAnimating = false,
	children,
}: Props = $props();

const catDef = $derived(getCategoryById(categoryId));
const color = $derived(catDef?.color ?? 'var(--theme-primary)');
const name = $derived(catDef?.name ?? '');

const css = $derived(CARD_SIZE_CSS[cardSize]);
const gridStyle = $derived(
	`grid-template-columns: repeat(auto-fill, minmax(${css.minWidth}, 1fr));`,
);

// Collapsible state
let expanded = $state(false);
const shouldCollapse = $derived(
	collapsible && itemsPerCategory > 0 && itemCount > itemsPerCategory,
);
const ROW_HEIGHTS: Record<CardSize, number> = { small: 90, medium: 120, large: 160 };
const MIN_COLS: Record<CardSize, number> = { small: 4, medium: 3, large: 2 };
const collapsedRows = $derived(Math.ceil(itemsPerCategory / MIN_COLS[cardSize]));
const collapsedMaxHeight = $derived(`${collapsedRows * ROW_HEIGHTS[cardSize]}px`);

/** レベル内のXP進捗率（0〜100%） */
function xpBarPct(xp: CategoryXpInfo): number {
	if (xp.maxValue <= 0) return 0;
	const normalized = (xp.value / xp.maxValue) * 100;
	const levelMin = (xp.level - 1) * 10;
	return Math.min(100, Math.max(0, ((normalized - levelMin) / 10) * 100));
}
</script>

<section class="mb-[var(--sp-sm)]">
	<div class="flex items-center gap-1 mb-1 px-1">
		<h2 class="flex items-center gap-1">
			<span
				class="w-1 h-4 rounded-[var(--radius-full)]"
				style="background-color: {color};"
				aria-hidden="true"
			></span>
			<span class="text-xs font-bold text-[var(--color-text-muted)]">{name}</span>
		</h2>
		{#if xpInfo}
			<span class="text-[10px] font-bold" style="color: {color};">Lv.{xpInfo.level}</span>
			<div class="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden" data-testid="xp-bar-{categoryId}">
				<div
					class="h-full rounded-full xp-bar__fill"
					class:xp-bar--animating={xpAnimating}
					style="width: {xpBarPct(xpInfo)}%; background-color: {color};"
				></div>
			</div>
		{/if}
	</div>
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
