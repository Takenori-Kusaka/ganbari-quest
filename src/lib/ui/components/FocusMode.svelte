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
	showAllActivities: boolean;
	onToggleShowAll: () => void;
	activitySlot: Snippet<[Activity]>;
}

let {
	recommendedActivities,
	allCompleted,
	completedCount,
	totalCount,
	showAllActivities,
	onToggleShowAll,
	activitySlot,
}: Props = $props();
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

	<!-- Recommended activities grid -->
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

	<!-- Toggle to show all activities -->
	<button
		class="show-all-btn"
		onclick={onToggleShowAll}
		data-testid="focus-show-all"
	>
		{showAllActivities ? '▲ おすすめだけ みる' : '▼ ほかの がんばり'}
	</button>
</div>

<style>
	.focus-mode {
		margin-bottom: 16px;
	}

	.focus-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	.focus-star {
		font-size: 1.5rem;
	}

	.focus-title {
		font-size: 1.125rem;
		font-weight: 800;
		color: var(--color-text, #1f2937);
	}

	.focus-progress {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
		padding: 8px 12px;
		background: rgba(251, 191, 36, 0.1);
		border-radius: 12px;
	}

	.progress-dot {
		font-size: 1.25rem;
		transition: transform 0.3s ease;
	}

	.progress-dot.completed {
		transform: scale(1.2);
	}

	.progress-count {
		margin-left: auto;
		font-size: 0.875rem;
		font-weight: 700;
		color: #92400e;
	}

	.focus-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-bottom: 12px;
	}

	.focus-bonus {
		text-align: center;
		padding: 16px;
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		border: 2px solid #fbbf24;
		border-radius: 16px;
		margin-bottom: 12px;
		animation: bounceIn 0.5s ease;
	}

	@keyframes bounceIn {
		0% { transform: scale(0.8); opacity: 0; }
		60% { transform: scale(1.05); }
		100% { transform: scale(1); opacity: 1; }
	}

	.bonus-emoji {
		font-size: 2rem;
		display: block;
		margin-bottom: 4px;
	}

	.bonus-text {
		font-size: 1rem;
		font-weight: 800;
		color: #78350f;
		margin: 0;
	}

	.bonus-sub-points {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-point, #d97706);
		margin: 4px 0 0;
		animation: point-pop 0.4s ease-out;
	}

	.bonus-sub {
		font-size: 0.75rem;
		color: #92400e;
		margin: 4px 0 0;
	}

	@keyframes point-pop {
		0% { transform: scale(0.5); opacity: 0; }
		60% { transform: scale(1.2); }
		100% { transform: scale(1); opacity: 1; }
	}

	.focus-hint {
		text-align: center;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #92400e;
		margin: 0 0 12px;
	}

	.show-all-btn {
		display: block;
		width: 100%;
		padding: 10px;
		background: var(--color-surface, #f9fafb);
		border: 1px solid var(--color-border, #e5e7eb);
		border-radius: 12px;
		color: var(--color-text-muted, #6b7280);
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.show-all-btn:hover {
		background: var(--color-border, #e5e7eb);
	}
</style>
