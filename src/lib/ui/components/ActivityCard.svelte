<script lang="ts">
	interface Props {
		icon: string;
		name: string;
		category: string;
		completed?: boolean;
		streakDays?: number;
		onclick?: () => void;
	}

	let { icon, name, category, completed = false, streakDays = 0, onclick }: Props = $props();

	const categoryColors: Record<string, string> = {
		うんどう: 'var(--color-cat-undou)',
		べんきょう: 'var(--color-cat-benkyou)',
		おてつだい: 'var(--color-cat-otetsudai)',
		コミュニケーション: 'var(--color-cat-comm)',
		せいかつ: 'var(--color-cat-seikatsu)',
	};

	const borderColor = $derived(categoryColors[category] ?? 'var(--theme-primary)');
</script>

<button
	class="tap-target relative flex flex-col items-center justify-center gap-1
		w-[80px] h-[100px] rounded-[var(--radius-md)] bg-white shadow-sm
		border-2 transition-all
		{completed ? 'opacity-50 pointer-events-none' : 'hover:shadow-md'}"
	style="border-color: {borderColor};"
	disabled={completed}
	aria-label="{name}{completed ? '（きろくずみ）' : ''}"
	{onclick}
>
	{#if completed}
		<div class="absolute top-1 right-1 text-sm" aria-hidden="true">✅</div>
	{/if}

	<span class="text-4xl" aria-hidden="true">{icon}</span>
	<span class="text-xs font-bold leading-tight text-center line-clamp-2">{name}</span>

	{#if streakDays >= 2}
		<div class="absolute -bottom-1 left-1/2 -translate-x-1/2 flex" aria-label="{streakDays}にちれんぞく">
			{#each Array(Math.min(streakDays, 5)) as _, i}
				<span class="text-xs animate-flame" aria-hidden="true">🔥</span>
			{/each}
		</div>
	{/if}
</button>
