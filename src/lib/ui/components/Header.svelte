<script lang="ts">
import type { PointSettings } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS, formatPointValue } from '$lib/domain/point-display';
import AvatarDisplay from '$lib/ui/components/AvatarDisplay.svelte';

interface Props {
	nickname: string;
	totalPoints: number;
	avatarUrl?: string | null;
	pointSettings?: PointSettings;
	activeTitle?: { icon: string; name: string } | null;
	stampProgress?: { filled: number; total: number } | null;
	onStampClick?: () => void;
	isPremium?: boolean;
}

let {
	nickname,
	totalPoints,
	avatarUrl,
	pointSettings,
	activeTitle,
	stampProgress,
	onStampClick,
	isPremium = false,
}: Props = $props();

const settings = $derived(pointSettings ?? DEFAULT_POINT_SETTINGS);
const balanceDisplay = $derived(
	formatPointValue(totalPoints, settings.mode, settings.currency, settings.rate),
);
</script>

<header
	class="sticky top-0 z-30 flex items-center justify-between px-[var(--sp-md)] py-[var(--sp-sm)]
		bg-[var(--theme-primary)] text-white shadow-md"
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
			<span class="font-bold text-lg leading-tight">{nickname}{#if isPremium}<span class="premium-star" title="プレミアム">⭐</span>{/if}</span>
			{#if activeTitle}
				<span class="text-xs opacity-90">{activeTitle.icon} {activeTitle.name}</span>
			{/if}
		</div>
	</div>
	<div class="flex items-center gap-2">
		{#if stampProgress}
			<button
				type="button"
				class="stamp-mini"
				data-testid="header-stamp-btn"
				onclick={() => onStampClick?.()}
				aria-label="スタンプカードを見る"
			>
				<span class="text-sm" aria-hidden="true">💮</span>
				<span class="text-xs font-bold">{stampProgress.filled}/{stampProgress.total}</span>
			</button>
		{/if}
		<div class="flex items-center gap-1 font-bold">
			<span class="text-xl" aria-hidden="true">⭐</span>
			<span class="text-lg">{balanceDisplay}</span>
		</div>
	</div>
</header>

<style>
	.stamp-mini {
		display: flex;
		align-items: center;
		gap: 2px;
		background: rgba(255, 255, 255, 0.2);
		border: none;
		border-radius: var(--radius-sm, 6px);
		padding: 2px 6px;
		color: white;
		cursor: pointer;
		transition: background 0.2s;
	}
	.stamp-mini:hover {
		background: rgba(255, 255, 255, 0.3);
	}
	.premium-star {
		font-size: 0.6em;
		margin-left: 2px;
		vertical-align: super;
		opacity: 0.8;
	}
</style>
