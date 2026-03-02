<script lang="ts">
interface Props {
	nickname: string;
	totalPoints: number;
	level?: number;
	showLevel?: boolean;
	avatarUrl?: string | null;
}

let { nickname, totalPoints, level, showLevel = true, avatarUrl }: Props = $props();
</script>

<header
	class="sticky top-0 z-30 flex items-center justify-between px-[var(--spacing-md)] py-[var(--spacing-sm)]
		bg-[var(--theme-primary)] text-white shadow-md"
>
	<div class="flex items-center gap-[var(--spacing-sm)]">
		{#if avatarUrl}
			<img
				src={avatarUrl}
				alt={nickname}
				class="w-8 h-8 rounded-full object-cover border-2 border-white/50"
			/>
		{:else}
			<span class="text-2xl" aria-hidden="true">👤</span>
		{/if}
		<span class="font-bold text-lg">{nickname}</span>
		{#if showLevel && level != null}
			<span class="text-sm opacity-80">Lv.{level}</span>
		{/if}
	</div>
	<div class="flex items-center gap-1 font-bold">
		<span class="text-xl" aria-hidden="true">⭐</span>
		<span class="text-lg">{totalPoints.toLocaleString()}P</span>
	</div>
</header>
