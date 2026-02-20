<script lang="ts">
	interface Props {
		days: number;
		bonusPoints: number;
	}

	let { days, bonusPoints }: Props = $props();
</script>

{#if days >= 2}
	<div class="flex flex-col items-center gap-1 animate-bounce-in">
		<div class="flex" aria-label="{days}にちれんぞく">
			{#each Array(Math.min(days, 10)) as _, i}
				<span class="text-2xl animate-flame" aria-hidden="true">🔥</span>
			{/each}
		</div>
		<p class="text-lg font-bold">
			{days}にちれんぞく！
			<span class="text-[var(--color-point)]">+{bonusPoints}ボーナス</span>
		</p>
	</div>
{/if}
