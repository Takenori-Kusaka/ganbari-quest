<script lang="ts">
import { ONBOARDING_LABELS } from '$lib/domain/labels';
import type { OnboardingItem, OnboardingProgress } from '$lib/server/services/onboarding-service';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	onboarding: OnboardingProgress;
}

let { onboarding }: Props = $props();

const requiredItems = $derived(onboarding.items.filter((i: OnboardingItem) => i.required));
const optionalItems = $derived(onboarding.items.filter((i: OnboardingItem) => !i.required));

const progressPct = $derived(
	onboarding.totalCount > 0
		? Math.round((onboarding.completedCount / onboarding.totalCount) * 100)
		: 0,
);
</script>

<div class="onboarding-card" data-testid="onboarding-checklist">
	<div class="header">
		<span>✅</span>
		<span class="title">{ONBOARDING_LABELS.title}</span>
	</div>

	<div class="progress-bar-wrap" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="セットアップ進捗 {progressPct}%">
		<div class="progress-bar" style:width="{progressPct}%"></div>
	</div>
	<p class="progress-text">{onboarding.completedCount}/{onboarding.totalCount} 完了 ({progressPct}%)</p>

	{#if onboarding.allCompleted}
		<p class="all-done">{ONBOARDING_LABELS.allRequiredCompleted}</p>
	{/if}

	<ul class="items">
		{#each requiredItems as item}
			<li class="item" class:completed={item.completed}>
				<span>{item.completed ? '✅' : '☐'}</span>
				<span class="item-label">{item.label}</span>
				{#if !item.completed}
					<a href={item.href} class="item-link">→</a>
				{/if}
			</li>
		{/each}
	</ul>

	{#if optionalItems.length > 0}
		<details class="optional">
			<summary class="optional-summary">
				{ONBOARDING_LABELS.optionalSectionHeader(optionalItems.length)}
			</summary>
			<ul class="items optional-items">
				{#each optionalItems as item}
					<li class="item" class:completed={item.completed}>
						<span>{item.completed ? '✅' : '☐'}</span>
						<span class="item-label">{item.label}</span>
						{#if !item.completed}
							<a href={item.href} class="item-link">→</a>
						{/if}
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if onboarding.nextRecommendation}
		<div class="next-rec">
			<span>→</span>
			<span>次のおすすめ:</span>
			<a href={onboarding.nextRecommendation.href} class="rec-link">
				{onboarding.nextRecommendation.label}
			</a>
		</div>
	{/if}

	{#if onboarding.allCompleted}
		<form method="POST" action="?/dismissOnboarding" class="dismiss">
			<Button type="submit" variant="ghost" size="sm">非表示にする</Button>
		</form>
	{/if}
</div>

<style>
	.onboarding-card {
		background: var(--color-surface-info);
		border: 1px solid var(--color-border-default);
		border-radius: 12px;
		padding: 16px;
	}
	.header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
	.title { font-weight: 700; font-size: 0.9375rem; color: var(--color-text-primary); }
	.progress-bar-wrap {
		height: 8px; background: var(--color-surface-tertiary);
		border-radius: 4px; overflow: hidden; margin-bottom: 4px;
	}
	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, var(--color-action-primary), var(--color-action-success));
		border-radius: 4px; transition: width 0.3s ease;
	}
	.progress-text { font-size: 0.6875rem; color: var(--color-text-muted); margin: 0 0 12px 0; }
	.all-done {
		font-size: 0.875rem; font-weight: 700; color: var(--color-action-success);
		margin: 0 0 12px 0; text-align: center;
	}
	.items { list-style: none; padding: 0; margin: 0 0 12px 0; display: flex; flex-direction: column; gap: 8px; }
	.item { display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--color-text); }
	.item.completed { color: var(--color-text-muted); }
	.item.completed .item-label { text-decoration: line-through; }
	.item-label { flex: 1; }
	.item-link {
		display: flex; align-items: center; justify-content: center;
		width: 28px; height: 28px; background: var(--color-action-primary);
		color: white; border-radius: 8px; text-decoration: none;
		font-size: 0.75rem; font-weight: 700; flex-shrink: 0; transition: background 0.15s;
	}
	.item-link:hover { background: var(--color-action-primary-hover); }
	.optional { margin-bottom: 12px; }
	.optional-summary {
		font-size: 0.8125rem; font-weight: 600; color: var(--color-text-secondary);
		cursor: pointer; padding: 6px 0; user-select: none;
	}
	.optional-summary:hover { color: var(--color-text-primary); }
	.optional-items { margin-top: 8px; margin-bottom: 0; padding-left: 8px; }
	.next-rec {
		display: flex; align-items: center; gap: 6px; font-size: 0.75rem;
		color: var(--color-text-primary); padding: 8px 12px;
		background: color-mix(in srgb, var(--color-action-primary) 8%, transparent); border-radius: 8px;
	}
	.rec-link { font-weight: 700; color: var(--color-text-link); text-decoration: underline; }
	.dismiss { margin-top: 12px; text-align: center; }
</style>
