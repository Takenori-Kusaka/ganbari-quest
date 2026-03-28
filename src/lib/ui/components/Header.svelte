<script lang="ts">
import type { PointSettings } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS, formatPointValue } from '$lib/domain/point-display';
import AvatarDisplay from '$lib/ui/components/AvatarDisplay.svelte';

interface Props {
	nickname: string;
	totalPoints: number;
	level?: number;
	showLevel?: boolean;
	avatarUrl?: string | null;
	avatarConfig?: { bgCss: string; frameCss: string; effectClass: string } | null;
	pointSettings?: PointSettings;
}

let {
	nickname,
	totalPoints,
	level,
	showLevel = true,
	avatarUrl,
	avatarConfig,
	pointSettings,
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
			bgCss={avatarConfig?.bgCss ?? '#ffffff'}
			frameCss={avatarConfig?.frameCss ?? '2px solid rgba(255,255,255,0.5)'}
			effectClass={avatarConfig?.effectClass ?? ''}
			size="sm"
		/>
		<span class="font-bold text-lg">{nickname}</span>
		{#if showLevel && level != null}
			<span class="text-sm opacity-80">Lv.{level}</span>
		{/if}
	</div>
	<div class="flex items-center gap-1 font-bold">
		<span class="text-xl" aria-hidden="true">⭐</span>
		<span class="text-lg">{balanceDisplay}</span>
	</div>
</header>
