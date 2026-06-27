<script lang="ts">
import type { Snippet } from 'svelte';
import { CARD_SIZE_CSS, type CardSize } from '$lib/domain/display-config';
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
import { CONCEPT_ICONS } from '$lib/domain/terms';
import { getCategoryById } from '$lib/domain/validation/activity';

/** #3333: 今週のチャレンジ対象カテゴリの進捗（旧 ChallengeBanner の代替表示）。非対象は null。 */
interface ChallengeTarget {
	current: number;
	target: number;
	remaining: number;
	completed: boolean;
}

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
	/** #3333: 今週のチャレンジ対象なら進捗、非対象は null。 */
	challengeTarget?: ChallengeTarget | null;
	/** #3333: 進捗の表示様式。preschool は 'dots'（ドット可視化）、それ以外は 'text'（「のこり○かい」）。 */
	challengeProgressStyle?: 'dots' | 'text';
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
	challengeTarget = null,
	challengeProgressStyle = 'text',
	children,
}: Props = $props();

// #3333: dots は小さい target のときのみ（過密回避）。大きい target は text にフォールバック。
const useDots = $derived(
	challengeProgressStyle === 'dots' && !!challengeTarget && challengeTarget.target <= 6,
);

const catDef = $derived(getCategoryById(categoryId));
const color = $derived(catDef?.color ?? 'var(--theme-primary)');
const accent = $derived(catDef?.accent ?? color);
const name = $derived(catDef?.name ?? '');
const icon = $derived(catDef?.icon ?? '');

const css = $derived(CARD_SIZE_CSS[cardSize]);
// Collapsible state — compactMode変更に追従
// #2148: collapsible=false の場合は expanded を常に true 固定（子供画面の誤タップ全消失対策、γ 採用 / 業界 prior art 7/7 整合）。
// 詳細: docs/reference/07-research-child-collapsible-prior-art.md
let expanded = $state(true);
$effect(() => {
	expanded = collapsible ? !compactMode : true;
});
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
	// #2148: collapsible=false の場合は折りたたみ操作自体を無効化
	if (!collapsible) return;
	expanded = !expanded;
}
</script>

<!--
	#3333: チャレンジ対象バッジ。旧 ChallengeBanner 横長バナーを撤去し、対象カテゴリの
	ヘッダーに静的バッジ + インライン進捗を表示（#2146/#2168 カード演出統合 / ADR-0012 無アニメ）。
	🎯 は CONCEPT_ICONS.challenge（SSOT）。進捗は preschool=ドット、他=「のこり○かい」。
-->
{#snippet challengeBadge()}
	{#if challengeTarget}
		{#if challengeTarget.completed}
			<span
				class="challenge-badge flex items-center gap-0.5 font-bold bg-[var(--color-surface-success)] text-[var(--color-feedback-success-text)] px-1.5 py-0.5 rounded-full"
				data-testid="challenge-target-badge-{categoryId}"
				data-challenge-complete="true"
				aria-label={UI_COMPONENTS_LABELS.challengeTargetAriaComplete(name)}
			>
				<span aria-hidden="true">{CONCEPT_ICONS.challenge}</span>
				<span aria-hidden="true">{UI_COMPONENTS_LABELS.challengeTargetComplete}</span>
			</span>
		{:else}
			<span
				class="challenge-badge flex items-center gap-0.5 font-bold bg-[var(--color-premium-bg)] text-[var(--color-premium-700)] px-1.5 py-0.5 rounded-full"
				data-testid="challenge-target-badge-{categoryId}"
				aria-label={UI_COMPONENTS_LABELS.challengeTargetAria(name, challengeTarget.remaining)}
			>
				<span aria-hidden="true">{CONCEPT_ICONS.challenge}</span>
				{#if useDots}
					<span class="flex items-center gap-0.5" aria-hidden="true">
						{#each Array(challengeTarget.target) as _, idx (idx)}
							<span
								class="w-1.5 h-1.5 rounded-full {idx < challengeTarget.current
									? 'bg-[var(--color-premium)]'
									: 'bg-[var(--color-premium-200)]'}"
							></span>
						{/each}
					</span>
				{:else}
					<span aria-hidden="true">{UI_COMPONENTS_LABELS.challengeTargetRemaining(challengeTarget.remaining)}</span>
				{/if}
			</span>
		{/if}
	{/if}
{/snippet}

<section class="mb-[var(--sp-sm)]">
	<!-- Category header (always visible) -->
	<!-- #2148: collapsible=false の場合はヘッダーを button ではなく div で描画し、誤タップ全消失を物理的に排除（γ 採用）。 -->
	{#if collapsible}
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
					style:background-color={accent}
					aria-hidden="true"
				></span>
				<span class="text-xs font-bold text-[var(--color-text-muted)]">{name}</span>
			</h2>
			{#if missionCount > 0}
				<span class="text-[10px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
					{completedMissionCount}/{missionCount}
				</span>
			{/if}
			{@render challengeBadge()}
			{#if xpInfo}
				<span class="text-[10px] font-bold" style:color={accent}>Lv.{xpInfo.level}</span>
				<div class="w-24 h-2.5 rounded-full bg-gray-200 overflow-hidden ml-1" data-testid="xp-bar-{categoryId}" role="progressbar" aria-valuenow={Math.round(xpBarPct(xpInfo))} aria-valuemin={0} aria-valuemax={100}>
					<div
						class="h-full rounded-full xp-bar__fill"
						class:xp-bar--animating={xpAnimating}
						style:width="{xpBarPct(xpInfo)}%"
					style:background-color={accent}
					></div>
				</div>
				<span class="text-[10px] text-[var(--color-text-muted)] tabular-nums w-8 text-right">{Math.round(xpBarPct(xpInfo))}%</span>
			{/if}
			{#if compactMode}
				<span class="text-xs text-[var(--color-text-muted)] ml-1">{expanded ? '▲' : '▼'}</span>
			{/if}
		</button>
	{:else}
		<div
			class="flex items-center gap-1 mb-1 px-1 w-full text-left"
			data-testid="category-header-{categoryId}"
		>
			{#if compactMode}
				<span class="text-xl">{icon}</span>
			{/if}
			<h2 class="flex items-center gap-1">
				<span
					class="w-1 h-4 rounded-[var(--radius-full)]"
					style:background-color={accent}
					aria-hidden="true"
				></span>
				<span class="text-xs font-bold text-[var(--color-text-muted)]">{name}</span>
			</h2>
			{#if missionCount > 0}
				<span class="text-[10px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
					{completedMissionCount}/{missionCount}
				</span>
			{/if}
			{@render challengeBadge()}
			{#if xpInfo}
				<span class="text-[10px] font-bold" style:color={accent}>Lv.{xpInfo.level}</span>
				<div class="w-24 h-2.5 rounded-full bg-gray-200 overflow-hidden ml-1" data-testid="xp-bar-{categoryId}" role="progressbar" aria-valuenow={Math.round(xpBarPct(xpInfo))} aria-valuemin={0} aria-valuemax={100}>
					<div
						class="h-full rounded-full xp-bar__fill"
						class:xp-bar--animating={xpAnimating}
						style:width="{xpBarPct(xpInfo)}%"
					style:background-color={accent}
					></div>
				</div>
				<span class="text-[10px] text-[var(--color-text-muted)] tabular-nums w-8 text-right">{Math.round(xpBarPct(xpInfo))}%</span>
			{/if}
		</div>
	{/if}

	<!-- Activity grid (expandable in compact mode) -->
	{#if expanded}
		<div
			class="grid gap-1 px-1"
			class:collapsed={shouldCollapse && !expanded}
			style:grid-template-columns="repeat(auto-fill, minmax({css.minWidth}, 1fr))"
			style:max-height={shouldCollapse && !expanded ? collapsedMaxHeight : undefined}
			style:overflow={shouldCollapse && !expanded ? 'hidden' : undefined}
		>
			{@render children()}
		</div>
		{#if shouldCollapse}
			<button
				class="w-full py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
				onclick={() => (expanded = !expanded)}
			>
				{expanded ? UI_COMPONENTS_LABELS.categorySectionCollapse : UI_COMPONENTS_LABELS.categorySectionExpand(itemCount - itemsPerCategory)}
			</button>
		{/if}
	{/if}
</section>

<style>
	/* #3333: challenge badge font-size follows the age-tier scale (--age-font-scale).
	   The old fixed text-[10px] became relatively too small for preschool / baby.
	   Base 10px = 0.625rem multiplied by the per-age scale (elementary=1.0 / preschool=1.2 / baby=1.5).
	   Colors go through §2 semantic tokens (success / premium); Tailwind palette literals removed. */
	.challenge-badge {
		font-size: calc(0.625rem * var(--age-font-scale, 1));
	}
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
