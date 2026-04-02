<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';

interface RankingData {
	childId: number;
	childName: string;
	totalCount: number;
	categoryCounts: Record<number, number>;
}

interface CategoryChampion {
	childId: number;
	childName: string;
	value: number;
}

interface Props {
	rankings: RankingData[];
	mostActive: { childId: number; childName: string; count: number } | null;
	categoryChampions: Record<number, CategoryChampion>;
	encouragement: string;
	childId: number;
}

let { rankings, mostActive, categoryChampions, encouragement, childId }: Props = $props();

const medals = ['🥇', '🥈', '🥉'];

function getCategoryName(id: number): string {
	const cat = CATEGORY_DEFS.find((c) => c.id === id);
	return cat?.name ?? '';
}

function getCategoryIcon(id: number): string {
	const cat = CATEGORY_DEFS.find((c) => c.id === id);
	return cat?.icon ?? '📋';
}
</script>

{#if rankings.length > 0}
	<div class="sibling-ranking" data-testid="sibling-ranking">
		<div class="sibling-ranking__header">
			<span class="sibling-ranking__title">📊 こんしゅうのランキング</span>
			<span class="sibling-ranking__encouragement">{encouragement}</span>
		</div>

		<!-- Most active -->
		{#if mostActive}
			<div class="sibling-ranking__highlight">
				<span class="sibling-ranking__crown">👑</span>
				<span class="sibling-ranking__highlight-text">
					{mostActive.childName}が{mostActive.count}かいでいちばん！
				</span>
			</div>
		{/if}

		<!-- Rankings list -->
		<div class="sibling-ranking__list">
			{#each rankings as entry, i}
				<div
					class="sibling-ranking__entry"
					class:sibling-ranking__entry--me={entry.childId === childId}
				>
					<span class="sibling-ranking__medal">{medals[i] ?? `${i + 1}`}</span>
					<span class="sibling-ranking__name">
						{entry.childId === childId ? 'じぶん' : entry.childName}
					</span>
					<span class="sibling-ranking__count">{entry.totalCount}かい</span>
				</div>
			{/each}
		</div>

		<!-- Category champions -->
		{#if Object.keys(categoryChampions).length > 0}
			<div class="sibling-ranking__categories">
				{#each Object.entries(categoryChampions) as [catId, champ]}
					<div class="sibling-ranking__category-chip">
						<span>{getCategoryIcon(Number(catId))}</span>
						<span class="sibling-ranking__category-name">{getCategoryName(Number(catId))}</span>
						<span class="sibling-ranking__category-champ">
							{champ.childId === childId ? 'じぶん' : champ.childName}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.sibling-ranking {
		background: linear-gradient(135deg, #fef9c3, #fef08a);
		border: 1px solid #facc1533;
		border-radius: var(--radius-md, 12px);
		padding: 12px;
		margin-bottom: 8px;
	}

	.sibling-ranking__header {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 8px;
	}

	.sibling-ranking__title {
		font-size: 0.75rem;
		font-weight: 700;
		color: #854d0e;
	}

	.sibling-ranking__encouragement {
		font-size: 0.625rem;
		color: #a16207;
	}

	.sibling-ranking__highlight {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(255, 255, 255, 0.6);
		border-radius: 8px;
		padding: 6px 10px;
		margin-bottom: 8px;
	}

	.sibling-ranking__crown {
		font-size: 1rem;
	}

	.sibling-ranking__highlight-text {
		font-size: 0.6875rem;
		font-weight: 600;
		color: #854d0e;
	}

	.sibling-ranking__list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 8px;
	}

	.sibling-ranking__entry {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.4);
	}

	.sibling-ranking__entry--me {
		background: rgba(255, 255, 255, 0.7);
		border: 1px solid #facc1555;
	}

	.sibling-ranking__medal {
		font-size: 0.875rem;
		width: 1.5rem;
		text-align: center;
		flex-shrink: 0;
	}

	.sibling-ranking__name {
		font-size: 0.6875rem;
		font-weight: 600;
		color: #713f12;
		flex: 1;
	}

	.sibling-ranking__count {
		font-size: 0.6875rem;
		font-weight: 700;
		color: #854d0e;
		flex-shrink: 0;
	}

	.sibling-ranking__categories {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.sibling-ranking__category-chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 8px;
		background: rgba(255, 255, 255, 0.5);
		border-radius: 12px;
		font-size: 0.5625rem;
	}

	.sibling-ranking__category-name {
		color: #854d0e;
		font-weight: 600;
	}

	.sibling-ranking__category-champ {
		color: #a16207;
		font-weight: 500;
	}
</style>
