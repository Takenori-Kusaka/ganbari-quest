<script lang="ts">
import { CARD_SIZE_CSS, type CardSize } from '$lib/domain/display-config';
import { getCategoryById } from '$lib/domain/validation/activity';
import CompoundIcon from './CompoundIcon.svelte';

const ICON_SIZE_MAP: Record<CardSize, 'md' | 'lg' | 'xl'> = {
	small: 'md',
	medium: 'lg',
	large: 'xl',
};

interface Props {
	activityId?: number;
	icon: string;
	name: string;
	categoryId: number;
	cardSize?: CardSize;
	completed?: boolean;
	count?: number;
	streakDays?: number;
	isMission?: boolean;
	isPinned?: boolean;
	triggerHint?: string | null;
	onclick?: () => void;
	onlongpress?: () => void;
}

let {
	activityId,
	icon,
	name,
	categoryId,
	cardSize = 'medium',
	completed = false,
	count = 0,
	streakDays = 0,
	isMission = false,
	isPinned = false,
	triggerHint,
	onclick,
	onlongpress,
}: Props = $props();

const iconSize = $derived(ICON_SIZE_MAP[cardSize]);
const textSize = $derived(CARD_SIZE_CSS[cardSize].textSize);

const showMission = $derived(isMission && !completed);

const borderColor = $derived(getCategoryById(categoryId)?.color ?? 'var(--theme-primary)');

// Long press detection
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressTriggered = false;

function handlePointerDown() {
	longPressTriggered = false;
	pressTimer = setTimeout(() => {
		longPressTriggered = true;
		onlongpress?.();
	}, 500);
}

function handlePointerUp() {
	if (pressTimer) {
		clearTimeout(pressTimer);
		pressTimer = null;
	}
}

function handleClick(e: Event) {
	if (longPressTriggered) {
		e.preventDefault();
		e.stopPropagation();
		longPressTriggered = false;
		return;
	}
	onclick?.();
}
</script>

<button
	class="tap-target relative flex flex-col items-center justify-center gap-0.5
		w-full aspect-[4/5] min-h-[60px] rounded-[var(--radius-md)] shadow-sm
		border-2 transition-all
		{completed ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300/50' : 'bg-white hover:shadow-md'}"
	class:card-mission={showMission}
	style:border-color={completed ? undefined : (showMission ? 'gold' : borderColor)}
	disabled={completed}
	data-testid={activityId != null ? `activity-card-${activityId}` : undefined}
	aria-label="{name}{completed ? '（きろくずみ）' : ''}{showMission ? '（ミッション）' : ''}{isPinned ? '（ピンどめ）' : ''}"
	onclick={handleClick}
	onpointerdown={handlePointerDown}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
	oncontextmenu={(e) => { e.preventDefault(); onlongpress?.(); }}
>
	{#if isPinned}
		<div class="absolute -top-1.5 -right-1.5 z-10" aria-hidden="true">
			<span class="text-xs">📌</span>
		</div>
	{/if}

	{#if showMission}
		<div class="card-mission__sparkle" aria-hidden="true"></div>
	{/if}

	{#if completed}
		<div class="absolute inset-0 flex items-center justify-center z-10" aria-hidden="true">
			<span class="text-3xl opacity-80 animate-bounce-in">💮</span>
		</div>
	{:else if count > 0}
		<div class="absolute -top-1 -right-1 z-10 flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold shadow-sm" aria-label="{count}かいきろくずみ">
			{count}
		</div>
	{/if}

	<CompoundIcon {icon} size={iconSize} faded={completed} />
	<span class="font-bold leading-tight text-center line-clamp-2 {completed ? 'opacity-40' : ''}" style:font-size={textSize}>{name}</span>
	{#if triggerHint && !completed}
		<span class="text-[9px] font-bold text-orange-500 leading-tight text-center line-clamp-1 px-0.5">{triggerHint}</span>
	{/if}

	{#if streakDays >= 2}
		<div class="absolute -bottom-1 left-1/2 -translate-x-1/2 flex" aria-label="{streakDays}にちれんぞく">
			{#each Array(Math.min(streakDays, 5)) as _, i}
				<span class="text-xs animate-flame" aria-hidden="true">🔥</span>
			{/each}
		</div>
	{/if}
</button>

<style>
	/* Holographic rainbow border (#0170) */
	.card-mission {
		position: relative;
		border-color: transparent !important;
		background-clip: padding-box;
		animation: breathing-glow 2s ease-in-out infinite;
	}

	.card-mission::before {
		content: '';
		position: absolute;
		inset: -2px;
		border-radius: inherit;
		background: linear-gradient(
			135deg,
			#ff6b6b, #ffd93d, #6bcb77, #4d96ff, #ff6b6b
		);
		background-size: 300% 300%;
		animation: holo-border 3s linear infinite;
		z-index: -1;
	}

	/* Shine sweep on tap (#0170) */
	.card-mission::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.6) 50%, transparent 60%);
		opacity: 0;
		pointer-events: none;
		z-index: 5;
	}

	.card-mission:active::after {
		opacity: 1;
		animation: card-shine 0.3s ease-out forwards;
	}

	/* Sparkle particles (#0170) */
	.card-mission__sparkle {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: visible;
		z-index: 10;
	}

	.card-mission__sparkle::before,
	.card-mission__sparkle::after {
		content: '✦';
		position: absolute;
		font-size: 0.6rem;
		color: gold;
		animation: sparkle-float 2s ease-in-out infinite;
	}
	.card-mission__sparkle::before { top: -4px; left: -4px; animation-delay: 0s; }
	.card-mission__sparkle::after  { top: -4px; right: -4px; animation-delay: 0.5s; }
</style>
