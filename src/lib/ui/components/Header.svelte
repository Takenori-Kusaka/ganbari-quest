<script lang="ts">
import type { Snippet } from 'svelte';
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
import type { PointSettings } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS, formatPointValue } from '$lib/domain/point-display';
import { pointFlight } from '$lib/features/point-flight/point-flight.svelte';
import AvatarDisplay from '$lib/ui/components/AvatarDisplay.svelte';

interface Props {
	nickname: string;
	totalPoints: number;
	avatarUrl?: string | null;
	pointSettings?: PointSettings;
	stampProgress?: { filled: number; total: number } | null;
	onStampClick?: () => void;
	onHelpClick?: () => void;
	isPremium?: boolean;
	/** #2168: 通知 bell (MilestoneBellButton 等) を help button 前に挿入する slot */
	notificationSlot?: Snippet;
	/**
	 * #4448: 残高の増減演出 (`+10P` が残高へ飛び込みカウントアップする) を有効にするか。
	 * true のときだけ残高要素を演出の到着点として登録する。
	 * baby モード (ADR-0011) と `?screenshot=all` (visual regression baseline) では false を渡す。
	 */
	animateBalance?: boolean;
}

let {
	nickname,
	totalPoints,
	avatarUrl,
	pointSettings,
	stampProgress,
	onStampClick,
	onHelpClick,
	isPremium = false,
	notificationSlot,
	animateBalance = false,
}: Props = $props();

const settings = $derived(pointSettings ?? DEFAULT_POINT_SETTINGS);
// #4448: 演出中は「変化前 → 変化後」を数えている途中の値を表示する。
// 演出していないときは常に実データ (totalPoints) をそのまま出す。
const shownPoints = $derived(
	animateBalance ? (pointFlight.displayBalance ?? totalPoints) : totalPoints,
);
const balanceDisplay = $derived(
	formatPointValue(shownPoints, settings.mode, settings.currency, settings.rate),
);

// #4448: 残高要素を演出の到着点として登録する。固定座標ではなく実 DOM の座標を使うため、
// 表示位置が変わっても (通知 bell / スタンプの有無で横位置が動く) 追従する。
let balanceEl = $state<HTMLElement | null>(null);
$effect(() => {
	if (!animateBalance || !balanceEl) return;
	return pointFlight.registerAnchor(balanceEl);
});
</script>

<header
	class="sticky top-0 z-30 flex items-center justify-between px-[var(--sp-md)] py-[var(--sp-sm)]
		bg-[var(--color-action-primary-strong)] text-white shadow-md"
>
	<div class="flex items-center gap-[var(--sp-sm)]">
		<AvatarDisplay
			{nickname}
			{avatarUrl}
			bgCss="#ffffff"
			frameCss="2px solid rgba(255,255,255,0.5)"
			effectClass=""
			size="sm"
		/>
		<div class="flex flex-col">
			<span class="font-bold text-lg leading-tight">{nickname}{#if isPremium}<span class="premium-star" title={UI_COMPONENTS_LABELS.headerPremiumTitle}>⭐</span>{/if}</span>
		</div>
	</div>
	<div class="flex items-center gap-2">
		<!-- #2168: 通知 bell slot (MilestoneBellButton 等)。help button より前に配置。 -->
		{#if notificationSlot}{@render notificationSlot()}{/if}
		{#if onHelpClick}
			<button
				type="button"
				class="help-btn"
				data-testid="header-help-btn"
				data-tutorial="tutorial-restart"
				onclick={() => onHelpClick?.()}
				aria-label={UI_COMPONENTS_LABELS.headerHelpAriaLabel}
			>
				<span class="text-sm font-bold">❓</span>
			</button>
		{/if}
		{#if stampProgress}
			<button
				type="button"
				class="stamp-mini"
				data-testid="header-stamp-btn"
				data-tutorial="stamp-progress"
				onclick={() => onStampClick?.()}
				aria-label={UI_COMPONENTS_LABELS.headerStampAriaLabel(
					stampProgress.filled,
					stampProgress.total,
				)}
			>
				<span class="text-sm" aria-hidden="true">💮</span>
				<span class="text-xs font-bold">{stampProgress.filled}/{stampProgress.total}</span>
			</button>
		{/if}
		<div class="flex items-center gap-1 font-bold">
			<span class="text-xl" aria-hidden="true">⭐</span>
			<span class="text-lg" bind:this={balanceEl} data-testid="header-balance">{balanceDisplay}</span>
		</div>
	</div>
</header>

<style>
	.stamp-mini {
		display: flex;
		align-items: center;
		gap: 2px;
		/* #4645: 白を重ねると地の色が薄まり、上に載る白文字が AA (4.5:1) を割る
		   (実測 3.23:1)。黒を重ねて地を濃くすることで白文字のコントラストを上げる。 */
		background: rgba(0, 0, 0, 0.18);
		border: none;
		border-radius: var(--radius-sm, 6px);
		padding: 2px 6px;
		color: white;
		cursor: pointer;
		transition: background 0.2s;
	}
	.stamp-mini:hover {
		background: rgba(0, 0, 0, 0.28);
	}
	.help-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: rgba(255, 255, 255, 0.25);
		border: none;
		border-radius: 50%;
		color: white;
		cursor: pointer;
		transition: background 0.2s;
	}
	.help-btn:hover {
		background: rgba(255, 255, 255, 0.4);
	}
	.premium-star {
		font-size: 0.6em;
		margin-left: 2px;
		vertical-align: super;
		opacity: 0.8;
	}
</style>
