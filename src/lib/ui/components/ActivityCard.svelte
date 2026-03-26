<script lang="ts">
import { getCategoryById } from '$lib/domain/validation/activity';
import CompoundIcon from './CompoundIcon.svelte';

interface Props {
	icon: string;
	name: string;
	categoryId: number;
	completed?: boolean;
	count?: number;
	streakDays?: number;
	isMission?: boolean;
	triggerHint?: string | null;
	onclick?: () => void;
}

let {
	icon,
	name,
	categoryId,
	completed = false,
	count = 0,
	streakDays = 0,
	isMission = false,
	triggerHint,
	onclick,
}: Props = $props();

const showMission = $derived(isMission && !completed);

const borderColor = $derived(getCategoryById(categoryId)?.color ?? 'var(--theme-primary)');
</script>

<button
	class="tap-target relative flex flex-col items-center justify-center gap-0.5
		w-full aspect-[4/5] min-h-[60px] rounded-[var(--radius-md)] shadow-sm
		border-2 transition-all
		{completed ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300/50' : 'bg-white hover:shadow-md'}"
	class:card-mission={showMission}
	style={completed ? '' : `border-color: ${showMission ? 'gold' : borderColor};`}
	disabled={completed}
	aria-label="{name}{completed ? '（きろくずみ）' : ''}{showMission ? '（ミッション）' : ''}"
	{onclick}
>
	{#if showMission}
		<div class="absolute -top-1.5 -left-1.5 z-10" aria-hidden="true">
			<span class="text-sm card-mission__star">⭐</span>
		</div>
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

	<CompoundIcon {icon} size="lg" faded={completed} />
	<span class="text-[10px] font-bold leading-tight text-center line-clamp-2 {completed ? 'opacity-40' : ''}">{name}</span>
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
	.card-mission {
		box-shadow: 0 0 12px rgba(255, 200, 0, 0.5);
		animation: pulse-gold 2s ease-in-out infinite;
	}

	@keyframes pulse-gold {
		0%,
		100% {
			box-shadow: 0 0 8px rgba(255, 200, 0, 0.4);
		}
		50% {
			box-shadow: 0 0 20px rgba(255, 200, 0, 0.8);
		}
	}

	.card-mission__star {
		animation: star-twinkle 1.5s ease-in-out infinite;
	}

	@keyframes star-twinkle {
		0%,
		100% {
			opacity: 0.7;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.2);
		}
	}
</style>
