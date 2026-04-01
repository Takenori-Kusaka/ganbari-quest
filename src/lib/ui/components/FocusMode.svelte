<script lang="ts">
import type { Snippet } from 'svelte';

interface Activity {
	id: number;
	icon: string;
	displayName?: string;
	name: string;
	basePoints: number;
	categoryId: number;
	dailyLimit: number | null;
}

interface Props {
	recommendedActivities: Activity[];
	allCompleted: boolean;
	completedCount: number;
	totalCount: number;
	activitySlot: Snippet<[Activity]>;
}

let { recommendedActivities, allCompleted, completedCount, totalCount, activitySlot }: Props =
	$props();
</script>

<div class="focus-mode" data-testid="focus-mode">
	<!-- Header -->
	<div class="focus-header">
		<span class="focus-star">⭐</span>
		<h2 class="focus-title">きょうの がんばり</h2>
	</div>

	<!-- Progress indicator -->
	<div class="focus-progress">
		{#each { length: totalCount } as _, i}
			<span class="progress-dot" class:completed={i < completedCount}>
				{i < completedCount ? '⭐' : '✨'}
			</span>
		{/each}
		<span class="progress-count">{completedCount}/{totalCount}</span>
	</div>

	<!-- Recommended activities grid (compact) -->
	<div class="focus-grid">
		{#each recommendedActivities as activity (activity.id)}
			{@render activitySlot(activity)}
		{/each}
	</div>

	<!-- All-completed bonus message -->
	{#if allCompleted}
		<div class="focus-bonus" data-testid="focus-bonus">
			<span class="bonus-emoji">🎉</span>
			<p class="bonus-text">きょうのミッション コンプリート！</p>
			<p class="bonus-sub-points">⭐ ボーナス +5ポイント！</p>
			<p class="bonus-sub">すごい！ あしたも がんばろう！</p>
		</div>
	{:else}
		<p class="focus-hint">{totalCount}つ できたら ⭐ボーナス！</p>
	{/if}
</div>

<style>
	.focus-mode {
		margin-bottom: 8px;
		padding: 12px;
		background: linear-gradient(135deg, rgba(251, 191, 36, 0.08), rgba(251, 191, 36, 0.02));
		border: 1px solid rgba(251, 191, 36, 0.2);
		border-radius: 16px;
	}

	.focus-header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 8px;
	}

	.focus-star {
		font-size: 1.25rem;
	}

	.focus-title {
		font-size: 1rem;
		font-weight: 800;
		color: var(--color-text, #1f2937);
	}

	.focus-progress {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 10px;
	}

	.progress-dot {
		font-size: 1.125rem;
		transition: transform 0.3s ease;
	}

	.progress-dot.completed {
		transform: scale(1.2);
	}

	.progress-count {
		margin-left: auto;
		font-size: 0.8125rem;
		font-weight: 700;
		color: #92400e;
	}

	.focus-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-bottom: 8px;
	}

	.focus-bonus {
		text-align: center;
		padding: 12px;
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		border: 2px solid #fbbf24;
		border-radius: 12px;
		animation: bounceIn 0.5s ease;
	}

	@keyframes bounceIn {
		0% { transform: scale(0.8); opacity: 0; }
		60% { transform: scale(1.05); }
		100% { transform: scale(1); opacity: 1; }
	}

	.bonus-emoji {
		font-size: 1.5rem;
		display: block;
		margin-bottom: 2px;
	}

	.bonus-text {
		font-size: 0.875rem;
		font-weight: 800;
		color: #78350f;
		margin: 0;
	}

	.bonus-sub-points {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--color-point, #d97706);
		margin: 2px 0 0;
		animation: point-pop 0.4s ease-out;
	}

	.bonus-sub {
		font-size: 0.6875rem;
		color: #92400e;
		margin: 2px 0 0;
	}

	@keyframes point-pop {
		0% { transform: scale(0.5); opacity: 0; }
		60% { transform: scale(1.2); }
		100% { transform: scale(1); opacity: 1; }
	}

	.focus-hint {
		text-align: center;
		font-size: 0.75rem;
		font-weight: 600;
		color: #92400e;
		margin: 0;
	}
</style>
