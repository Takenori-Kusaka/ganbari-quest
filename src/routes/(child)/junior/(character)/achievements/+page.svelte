<script lang="ts">
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const active = $derived(data.activeChallenge);
const history = $derived(data.history ?? []);
</script>

<svelte:head>
	<title>チャレンジ記録 - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--sp-sm)] py-[var(--sp-md)]">
	{#if active}
		<Card padding="md" class="mb-[var(--sp-md)]">
			{#snippet children()}
			<div class="flex items-center gap-2 mb-[var(--sp-sm)]">
				<span class="text-2xl">⚔️</span>
				<h2 class="text-base font-bold text-[var(--color-text)]">今週のチャレンジ</h2>
			</div>
			<p class="text-sm text-[var(--color-text-secondary)] mb-[var(--sp-sm)]">{active.description}</p>
			<div class="flex items-center gap-2">
				<div class="flex-1 h-3 bg-[var(--color-neutral-200)] rounded-full overflow-hidden">
					<div
						class="h-full rounded-full transition-all duration-500"
						class:bg-[var(--color-brand-500)]={active.status !== 'completed'}
						class:bg-[var(--color-success-500)]={active.status === 'completed'}
						style:width="{active.progressPercent}%"
					></div>
				</div>
				<span class="text-sm font-bold text-[var(--color-text)]">{active.currentCount}/{active.targetCount}</span>
			</div>
			{#if active.status === 'completed'}
				<p class="text-sm font-bold text-[var(--color-success-600)] mt-[var(--sp-sm)] text-center">クリア！おめでとう！</p>
			{/if}
			{/snippet}
		</Card>
	{/if}

	{#if history.length > 0}
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-sm)]">これまでのチャレンジ</h3>
		<div class="flex flex-col gap-[var(--sp-xs)]">
			{#each history as challenge (challenge.id)}
				<Card padding="sm">
					{#snippet children()}
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-bold text-[var(--color-text)]">{challenge.categoryName}</p>
							<p class="text-xs text-[var(--color-text-muted)]">{challenge.weekStart}〜</p>
						</div>
						<div class="text-right">
							<span class="text-sm font-bold">{challenge.currentCount}/{challenge.targetCount}</span>
							{#if challenge.status === 'completed'}
								<p class="text-xs font-bold text-[var(--color-success-600)]">クリア！</p>
							{:else if challenge.status === 'expired'}
								<p class="text-xs text-[var(--color-text-muted)]">終了</p>
							{:else}
								<p class="text-xs text-[var(--color-brand-500)]">チャレンジ中</p>
							{/if}
						</div>
					</div>
					{/snippet}
				</Card>
			{/each}
		</div>
	{:else if !active}
		<div class="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
			<span class="text-5xl mb-4">📋</span>
			<p class="text-lg font-bold mb-2">まだチャレンジ記録がありません</p>
			<p class="text-sm">チャレンジが始まったらここに記録されます</p>
		</div>
	{/if}
</div>
