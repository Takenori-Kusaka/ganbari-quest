<script lang="ts">
import { enhance } from '$app/forms';
import Logo from '$lib/ui/components/Logo.svelte';
import { playSound } from '$lib/ui/sound/play-sound';

let { data } = $props();

const knownThemes = new Set(['pink', 'blue', 'green', 'orange', 'purple']);
</script>

<svelte:head>
	<title>だれがつかう？ - がんばりクエスト</title>
</svelte:head>

<div class="portal-page min-h-dvh flex flex-col">
	{#if data.reason === 'admin_forbidden'}
		<div class="bg-[var(--color-gold-100)] text-[var(--color-gold-700)] py-3 px-4 text-center text-sm font-semibold border-b border-[var(--color-gold-500)]" role="alert">おやのアカウントでログインしてね</div>
	{/if}

	<header class="pt-10 px-6 pb-6 flex justify-center">
		<Logo variant="full" size={280} />
	</header>

	<main class="flex-1 px-4 pb-6 max-w-[480px] mx-auto w-full">
		<h1 class="text-2xl font-bold text-center text-[var(--color-neutral-900)] mb-6">だれがつかう？</h1>

		{#if data.children.length === 0}
			<div class="flex flex-col items-center py-12 text-[var(--color-neutral-400)]">
				<span class="text-[2.5rem] mb-2">👤</span>
				<p class="font-bold m-0">こどもがまだいないよ</p>
				<p class="text-sm mt-1">おやがかんりがめんからついかしてね</p>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each data.children as child (child.id)}
					{@const themeName = knownThemes.has(child.theme) ? child.theme : 'pink'}
					<form method="POST" action="?/select" use:enhance>
						<input type="hidden" name="childId" value={child.id} />
						<button
							type="submit"
							use:playSound={'tap'}
							class="child-button"
							data-testid="child-select-{child.id}"
							data-theme={themeName}
						>
							{#if child.avatarUrl}
								<img
									src={child.avatarUrl}
									alt={child.nickname}
									class="w-12 h-12 rounded-full object-cover border-2 border-[var(--theme-primary)] shrink-0"
									loading="lazy"
								/>
							{:else}
								<span class="text-[2.5rem] shrink-0">👤</span>
							{/if}
							<div class="flex-1 min-w-0">
								<p class="text-lg font-bold text-[var(--color-neutral-900)] m-0">{child.nickname}</p>
								<p class="text-sm text-[var(--color-neutral-400)] mt-0.5">{child.age}さい</p>
							</div>
							<span class="text-2xl text-[var(--color-neutral-300)] shrink-0" aria-hidden="true">▶</span>
						</button>
					</form>
				{/each}
			</div>
		{/if}
	</main>

	{#if data.showAdminLink}
		<footer class="p-4 text-center">
			<a href={data.adminLink} class="text-[var(--color-text-muted)] text-sm no-underline hover:text-[var(--color-brand-700)]">🔒 おやのかんりがめん</a>
		</footer>
	{/if}
</div>

<style>
	.portal-page {
		background: linear-gradient(135deg, var(--color-brand-100) 0%, var(--color-brand-50) 50%, var(--color-gold-100) 100%);
	}
	.child-button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: white;
		border: 2px solid var(--theme-primary);
		border-radius: 16px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
	}
	.child-button:hover {
		background: var(--theme-bg);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
		transform: translateY(-2px);
	}
	.child-button:active {
		transform: translateY(0);
	}
</style>
