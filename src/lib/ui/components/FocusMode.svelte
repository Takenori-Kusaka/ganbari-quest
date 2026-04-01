<script lang="ts">
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
	completedIds: Set<number>;
	onactivityclick?: (activity: Activity) => void;
}

let {
	recommendedActivities,
	allCompleted,
	completedCount,
	totalCount,
	completedIds,
	onactivityclick,
}: Props = $props();

const remaining = $derived(totalCount - completedCount);
</script>

<div class="daily-quest" data-testid="focus-mode">
	<div class="quest-header">
		<span class="quest-icon">⭐</span>
		<h2 class="quest-title">きょうの クエスト</h2>
		<span class="quest-progress">{completedCount}/{totalCount}</span>
	</div>

	<div class="quest-chips">
		{#each recommendedActivities as activity (activity.id)}
			<button
				class="quest-chip"
				class:completed={completedIds.has(activity.id)}
				onclick={() => onactivityclick?.(activity)}
				data-testid="quest-chip-{activity.id}"
			>
				<span class="chip-icon">{activity.icon}</span>
				<span class="chip-name">{activity.displayName ?? activity.name}</span>
				{#if completedIds.has(activity.id)}
					<span class="chip-check">✅</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if allCompleted}
		<div class="quest-bonus" data-testid="focus-bonus">
			<span>🎉</span> クエストクリア！ <span class="bonus-points">+10ポイント！</span>
		</div>
	{:else}
		<p class="quest-hint">あと{remaining}つで ⭐ボーナス！</p>
	{/if}
</div>

<style>
	.daily-quest {
		margin-bottom: 8px;
		padding: 10px 12px;
		background: linear-gradient(135deg, rgba(251, 191, 36, 0.08), rgba(251, 191, 36, 0.02));
		border: 1px solid rgba(251, 191, 36, 0.2);
		border-radius: 12px;
	}

	.quest-header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
	}

	.quest-icon { font-size: 1rem; }

	.quest-title {
		font-size: 0.8125rem;
		font-weight: 800;
		color: var(--color-text, #1f2937);
		flex: 1;
	}

	.quest-progress {
		font-size: 0.75rem;
		font-weight: 700;
		color: #92400e;
	}

	.quest-chips {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
	}

	.quest-chip {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px;
		border-radius: 10px;
		border: 1.5px solid rgba(251, 191, 36, 0.3);
		background: white;
		font-size: 0.6875rem;
		font-weight: 600;
		min-height: 36px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.quest-chip:hover {
		border-color: #fbbf24;
		background: #fffbeb;
	}

	.quest-chip.completed {
		background: #fef3c7;
		border-color: #fbbf24;
		opacity: 0.7;
	}

	.chip-icon { font-size: 1.125rem; flex-shrink: 0; }

	.chip-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}

	.chip-check { flex-shrink: 0; font-size: 0.75rem; }

	.quest-bonus {
		text-align: center;
		font-size: 0.75rem;
		font-weight: 700;
		color: #78350f;
		padding: 6px;
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		border: 1.5px solid #fbbf24;
		border-radius: 8px;
		animation: bounceIn 0.5s ease;
	}

	.bonus-points {
		color: var(--color-point, #d97706);
	}

	@keyframes bounceIn {
		0% { transform: scale(0.8); opacity: 0; }
		60% { transform: scale(1.05); }
		100% { transform: scale(1); opacity: 1; }
	}

	.quest-hint {
		text-align: center;
		font-size: 0.6875rem;
		font-weight: 600;
		color: #92400e;
		margin: 0;
	}
</style>
