<script lang="ts">
	import CompoundIcon from './CompoundIcon.svelte';

	interface Props {
		icon: string;
		name: string;
		category: string;
		completed?: boolean;
		count?: number;
		streakDays?: number;
		onclick?: () => void;
	}

	let { icon, name, category, completed = false, count = 0, streakDays = 0, onclick }: Props = $props();

	const categoryColors: Record<string, string> = {
		うんどう: 'var(--color-cat-undou)',
		べんきょう: 'var(--color-cat-benkyou)',
		せいかつ: 'var(--color-cat-seikatsu)',
		こうりゅう: 'var(--color-cat-kouryuu)',
		そうぞう: 'var(--color-cat-souzou)',
	};

	const borderColor = $derived(categoryColors[category] ?? 'var(--theme-primary)');
</script>

<button
	class="tap-target relative flex flex-col items-center justify-center gap-0.5
		w-full aspect-[4/5] min-h-[60px] rounded-[var(--radius-md)] shadow-sm
		border-2 transition-all
		{completed ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300/50' : 'bg-white hover:shadow-md'}"
	style={completed ? '' : `border-color: ${borderColor};`}
	disabled={completed}
	aria-label="{name}{completed ? '（きろくずみ）' : ''}"
	{onclick}
>
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

	{#if streakDays >= 2}
		<div class="absolute -bottom-1 left-1/2 -translate-x-1/2 flex" aria-label="{streakDays}にちれんぞく">
			{#each Array(Math.min(streakDays, 5)) as _, i}
				<span class="text-xs animate-flame" aria-hidden="true">🔥</span>
			{/each}
		</div>
	{/if}
</button>
