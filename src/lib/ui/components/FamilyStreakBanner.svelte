<script lang="ts">
interface Props {
	currentStreak: number;
	hasRecordedToday: boolean;
	todayRecorders: number[];
	childId: number;
	siblings?: { id: number; nickname: string }[];
	nextMilestone?: { days: number; points: number; remaining: number } | null;
}

let {
	currentStreak,
	hasRecordedToday,
	todayRecorders,
	childId,
	siblings = [],
	nextMilestone = null,
}: Props = $props();

function getSiblingName(id: number): string {
	if (id === childId) return 'じぶん';
	return siblings.find((s) => s.id === id)?.nickname ?? `#${id}`;
}
</script>

{#if currentStreak > 0 || hasRecordedToday}
	<div class="family-streak" data-testid="family-streak-banner">
		<div class="family-streak__header">
			<span class="family-streak__icon">🔥</span>
			<span class="family-streak__days">
				かぞくストリーク: <strong>{currentStreak}にち</strong>
			</span>
		</div>

		{#if todayRecorders.length > 0}
			<div class="family-streak__today">
				きょう がんばった:
				{#each todayRecorders as rid, i}
					<span class="family-streak__recorder" class:family-streak__recorder--me={rid === childId}>
						{getSiblingName(rid)}
					</span>{#if i < todayRecorders.length - 1}{' '}{/if}
				{/each}
				✅
			</div>
		{:else}
			<div class="family-streak__warning">
				きょうは まだだよ！ だれか がんばろう！
			</div>
		{/if}

		{#if nextMilestone}
			<div class="family-streak__milestone">
				あと{nextMilestone.remaining}にちで {nextMilestone.days}にちボーナス（+{nextMilestone.points}P）
			</div>
		{/if}
	</div>
{/if}

<style>
	.family-streak {
		padding: 10px 12px;
		border-radius: var(--radius-md, 12px);
		background: linear-gradient(135deg, var(--color-rarity-rare-bg, #fef3c7), var(--color-rarity-common-bg, #fff7ed));
		border: 1px solid var(--color-rarity-rare, #f59e0b33);
		margin-bottom: 8px;
	}

	.family-streak__header {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.family-streak__icon {
		font-size: 1.25rem;
	}

	.family-streak__days {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-primary, #92400e);
	}

	.family-streak__today {
		font-size: 0.625rem;
		color: var(--color-text-muted, #78716c);
		margin-top: 4px;
	}

	.family-streak__recorder {
		font-weight: 600;
		color: var(--color-text-secondary, #78716c);
	}

	.family-streak__recorder--me {
		color: var(--theme-primary, #8b5cf6);
	}

	.family-streak__warning {
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-warning, #dc2626);
		margin-top: 4px;
	}

	.family-streak__milestone {
		font-size: 0.5625rem;
		color: var(--color-text-muted, #78716c);
		margin-top: 4px;
	}
</style>
