<script lang="ts">
import { enhance } from '$app/forms';
import { playSound } from '$lib/ui/sound/play-sound';

let { data } = $props();

const themeColors: Record<string, { bg: string; border: string }> = {
	pink: { bg: '#fff0f5', border: '#ff69b4' },
	blue: { bg: '#e3f2fd', border: '#4fc3f7' },
	green: { bg: '#e8f5e9', border: '#66bb6a' },
	orange: { bg: '#fff3e0', border: '#ffa726' },
	purple: { bg: '#f3e5f5', border: '#ab47bc' },
};

const defaultTheme = { bg: '#f5f5f5', border: '#9e9e9e' };
</script>

<svelte:head>
	<title>きりかえ - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-lg)]">
	<h1 class="text-xl font-bold text-center mb-[var(--spacing-lg)]">だれがつかう？</h1>

	{#if data.children.length === 0}
		<div class="flex flex-col items-center py-[var(--spacing-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--spacing-sm)]">👤</span>
			<p class="font-bold">こどもがまだいないよ</p>
			<p class="text-sm">おやがかんりがめんからついかしてね</p>
		</div>
	{:else}
		<div class="flex flex-col gap-[var(--spacing-md)]">
			{#each data.children as child (child.id)}
				{@const colors = themeColors[child.theme] ?? defaultTheme}
				<form method="POST" action="?/select" use:enhance>
					<input type="hidden" name="childId" value={child.id} />
					<button
						type="submit"
						use:playSound={'tap'}
						class="tap-target w-full flex items-center gap-[var(--spacing-md)] p-[var(--spacing-md)]
							rounded-[var(--radius-lg)] shadow-sm border-2 transition-shadow hover:shadow-md"
						style="background-color: {colors.bg}; border-color: {colors.border};"
					>
						{#if child.avatarUrl}
							<img
								src={child.avatarUrl}
								alt={child.nickname}
								class="w-12 h-12 rounded-full object-cover border-2"
								style="border-color: {colors.border};"
								loading="lazy"
							/>
						{:else}
							<span class="text-4xl">👤</span>
						{/if}
						<div class="flex-1 text-left">
							<p class="text-lg font-bold">{child.nickname}</p>
							<p class="text-sm text-[var(--color-text-muted)]">
								{child.age}さい
							</p>
						</div>
						<span class="text-2xl" aria-hidden="true">▶</span>
					</button>
				</form>
			{/each}
		</div>
	{/if}

	<!-- Parent admin link -->
	<div class="mt-[var(--spacing-2xl)] flex justify-center">
		<a
			href={data.adminLink}
			class="text-sm text-[var(--color-text-muted)] hover:text-[var(--theme-primary)] transition-colors py-2 px-4"
		>
			🔒 おやのかんりがめん
		</a>
	</div>

</div>
