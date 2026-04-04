<script lang="ts">
interface RankingData {
	childId: number;
	childName: string;
	totalCount: number;
	categoryCounts: Record<number, number>;
}

interface Props {
	rankings: RankingData[];
	childId: number;
}

let { rankings, childId }: Props = $props();
</script>

{#if rankings.length > 1}
	<div class="sibling-summary" data-testid="sibling-ranking">
		<span class="sibling-summary__icon">👫</span>
		<span class="sibling-summary__text">
			{#each rankings as entry, i}
				{#if i > 0}<span class="sibling-summary__sep"> / </span>{/if}
				<span class:sibling-summary__me={entry.childId === childId}>
					{entry.childId === childId ? 'じぶん' : entry.childName}　{entry.totalCount}かい
				</span>
			{/each}
			<span class="sibling-summary__period">（こんしゅう）</span>
		</span>
	</div>
{/if}

<style>
	.sibling-summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface-card, #fff);
		border: 1px solid var(--color-border-default, #e2e8f0);
		border-radius: var(--radius-md, 12px);
		font-size: 0.8rem;
		color: var(--color-text-secondary, #64748b);
	}

	.sibling-summary__icon {
		font-size: 1rem;
		flex-shrink: 0;
	}

	.sibling-summary__text {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.125rem;
	}

	.sibling-summary__me {
		font-weight: 700;
		color: var(--color-text-primary, #1e293b);
	}

	.sibling-summary__sep {
		color: var(--color-text-tertiary, #94a3b8);
	}

	.sibling-summary__period {
		color: var(--color-text-tertiary, #94a3b8);
		font-size: 0.75rem;
	}
</style>
