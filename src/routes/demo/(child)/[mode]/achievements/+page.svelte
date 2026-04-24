<script lang="ts">
import { APP_LABELS, DEMO_CHILD_ACHIEVEMENTS_LABELS, PAGE_TITLES } from '$lib/domain/labels';

let { data } = $props();
</script>

<svelte:head>
	<title>{PAGE_TITLES.childAchievements}{APP_LABELS.demoPageTitleSuffix}</title>
</svelte:head>

{#if data.challenges.length === 0}
	<div class="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
		<span class="text-5xl mb-4">📋</span>
		<p class="text-lg font-bold mb-2">{DEMO_CHILD_ACHIEVEMENTS_LABELS.emptyTitle}</p>
		<p class="text-sm">{DEMO_CHILD_ACHIEVEMENTS_LABELS.emptyDesc}</p>
	</div>
{:else}
	<div class="px-[var(--sp-md)] space-y-4">
		<h2 class="text-lg font-bold">{DEMO_CHILD_ACHIEVEMENTS_LABELS.sectionTitle}</h2>

		{#each data.challenges as challenge (challenge.id)}
			<div class="rounded-xl border bg-white p-4 {challenge.completed ? 'border-[var(--color-feedback-success-border)]' : 'border-[var(--color-feedback-info-border)]'}">
				<h3 class="font-bold text-sm">
					{challenge.title}
					{#if challenge.completed}
						<span class="ml-1 rounded bg-[var(--color-feedback-success-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-success-text)]">{DEMO_CHILD_ACHIEVEMENTS_LABELS.clearedBadge}</span>
					{:else}
						<span class="ml-1 rounded bg-[var(--color-feedback-info-bg-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-feedback-info-text)]">{DEMO_CHILD_ACHIEVEMENTS_LABELS.inProgressBadge}</span>
					{/if}
				</h3>
				{#if challenge.description}
					<p class="text-xs text-[var(--color-text-secondary)] mt-1">{challenge.description}</p>
				{/if}
				<div class="mt-2 flex items-center gap-2">
					<div class="flex-1 h-2 bg-[var(--color-surface-secondary)] rounded-full overflow-hidden">
						<div
							class="h-full rounded-full transition-all {challenge.completed ? 'bg-[var(--color-feedback-success-border)]' : 'bg-[var(--color-feedback-info-border)]'}"
							style:width="{Math.min(100, Math.round((challenge.currentValue / challenge.targetValue) * 100))}%"
						></div>
					</div>
					<span class="text-[10px] text-[var(--color-text-muted)]">
						{challenge.currentValue}/{challenge.targetValue}
						{#if challenge.completed}✅{/if}
					</span>
				</div>
				{#if challenge.completed && challenge.rewardMessage}
					<p class="mt-2 text-xs text-[var(--color-feedback-success-text)] font-medium">🎉 {challenge.rewardMessage} (+{challenge.rewardPoints}P)</p>
				{/if}
			</div>
		{/each}
	</div>
{/if}
