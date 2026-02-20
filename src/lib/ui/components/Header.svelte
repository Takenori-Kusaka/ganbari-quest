<script lang="ts">
	interface Props {
		nickname: string;
		totalPoints: number;
		level?: number;
	}

	let { nickname, totalPoints, level }: Props = $props();
</script>

<header
	class="sticky top-0 z-30 flex items-center justify-between px-[var(--spacing-md)] py-[var(--spacing-sm)]
		bg-[var(--theme-primary)] text-white shadow-md"
>
	<div class="flex items-center gap-[var(--spacing-sm)]">
		<span class="text-2xl" aria-hidden="true">👤</span>
		<span class="font-bold text-lg">{nickname}</span>
		{#if level != null}
			<span class="text-sm opacity-80">Lv.{level}</span>
		{/if}
	</div>
	<div class="flex items-center gap-1 font-bold">
		<span class="text-xl" aria-hidden="true">⭐</span>
		<span class="text-lg">{totalPoints.toLocaleString()}P</span>
	</div>
</header>
