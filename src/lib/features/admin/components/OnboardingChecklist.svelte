<script lang="ts">
import type { OnboardingProgress } from '$lib/server/services/onboarding-service';

interface Props {
	onboarding: OnboardingProgress;
}

let { onboarding }: Props = $props();

const progressPct = $derived(
	onboarding.totalCount > 0
		? Math.round((onboarding.completedCount / onboarding.totalCount) * 100)
		: 0,
);
</script>

<div class="onboarding-card" data-testid="onboarding-checklist">
	<div class="onboarding-header">
		<span class="onboarding-icon">✅</span>
		<span class="onboarding-title">はじめてのセットアップ</span>
	</div>

	<!-- Progress bar -->
	<div class="progress-bar-container">
		<div class="progress-bar" style:width="{progressPct}%"></div>
	</div>
	<p class="progress-text">{onboarding.completedCount}/{onboarding.totalCount} 完了 ({progressPct}%)</p>

	<!-- Checklist items -->
	<ul class="checklist-items">
		{#each onboarding.items as item}
			<li class="checklist-item" class:completed={item.completed}>
				<span class="check-icon">{item.completed ? '✅' : '☐'}</span>
				<span class="item-label">{item.label}</span>
				{#if !item.completed}
					<a href={item.href} class="item-link">→</a>
				{/if}
			</li>
		{/each}
	</ul>

	<!-- Next recommendation -->
	{#if onboarding.nextRecommendation}
		<div class="next-recommendation">
			<span class="recommendation-arrow">→</span>
			<span>次のおすすめ:</span>
			<a href={onboarding.nextRecommendation.href} class="recommendation-link">
				{onboarding.nextRecommendation.label}
			</a>
		</div>
	{/if}

	<!-- Dismiss button -->
	{#if onboarding.allCompleted}
		<form method="POST" action="?/dismissOnboarding" class="dismiss-form">
			<button type="submit" class="dismiss-btn">非表示にする</button>
		</form>
	{/if}
</div>

<style>
	.onboarding-card {
		background: linear-gradient(135deg, var(--color-brand-50), var(--color-rarity-common-bg));
		border: 1px solid var(--color-brand-200);
		border-radius: 12px;
		padding: 16px;
	}

	.onboarding-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	.onboarding-icon {
		font-size: 1.25rem;
	}

	.onboarding-title {
		font-weight: 700;
		font-size: 0.9375rem;
		color: var(--color-brand-800);
	}

	.progress-bar-container {
		height: 8px;
		background: var(--color-neutral-200);
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 4px;
	}

	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, var(--color-action-primary), var(--color-success));
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.progress-text {
		font-size: 0.6875rem;
		color: var(--color-neutral-500);
		margin: 0 0 12px 0;
	}

	.checklist-items {
		list-style: none;
		padding: 0;
		margin: 0 0 12px 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.checklist-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8125rem;
		color: var(--color-text);
	}

	.checklist-item.completed {
		color: var(--color-text-muted);
	}

	.checklist-item.completed .item-label {
		text-decoration: line-through;
	}

	.check-icon {
		font-size: 1rem;
		flex-shrink: 0;
	}

	.item-label {
		flex: 1;
	}

	.item-link {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: var(--color-action-primary);
		color: white;
		border-radius: 8px;
		text-decoration: none;
		font-size: 0.75rem;
		font-weight: 700;
		flex-shrink: 0;
		transition: background 0.15s;
	}

	.item-link:hover {
		background: var(--color-brand-700);
	}

	.next-recommendation {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.75rem;
		color: var(--color-brand-800);
		padding: 8px 12px;
		background: color-mix(in srgb, var(--color-action-primary) 8%, transparent);
		border-radius: 8px;
	}

	.recommendation-arrow {
		font-weight: 700;
	}

	.recommendation-link {
		font-weight: 700;
		color: var(--color-brand-800);
		text-decoration: underline;
	}

	.dismiss-form {
		margin-top: 12px;
		text-align: center;
	}

	.dismiss-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.6875rem;
		cursor: pointer;
		text-decoration: underline;
	}

	.dismiss-btn:hover {
		color: var(--color-neutral-500);
	}
</style>
