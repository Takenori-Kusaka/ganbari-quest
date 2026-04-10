<script lang="ts">
import type { BattleResult, BattleStats, Enemy } from '$lib/domain/battle-types';
import BattleScene from './BattleScene.svelte';

let {
	data,
}: {
	data: {
		child: { id: number; uiMode: string } | null;
		battle: {
			battleId: number;
			enemy: Enemy;
			playerStats: BattleStats;
			scaledEnemyMaxHp: number;
			completed: boolean;
			result: { outcome: 'win' | 'lose'; rewardPoints: number; turnsUsed: number } | null;
		} | null;
	};
} = $props();

let battleResult = $state<BattleResult | null>(null);
let loading = $state(false);

async function handleStartBattle() {
	if (!data.battle || !data.child) return;
	loading = true;
	try {
		const res = await fetch(`/api/v1/battle/${data.child.id}`, {
			method: 'POST',
		});
		if (res.ok) {
			const result = await res.json();
			battleResult = result.battleResult;
		}
	} finally {
		loading = false;
	}
}
</script>

<div class="battle-page" data-testid="battle-page">
	<h2 class="page-title">⚔️ きょうの バトル</h2>

	{#if data.battle}
		<BattleScene
			enemy={data.battle.enemy}
			playerStats={data.battle.playerStats}
			scaledEnemyMaxHp={data.battle.scaledEnemyMaxHp}
			{battleResult}
			onStartBattle={handleStartBattle}
			completed={data.battle.completed}
		/>
	{:else}
		<div class="no-battle">
			<p>バトルじょうほうを よみこめませんでした</p>
		</div>
	{/if}

	{#if loading}
		<div class="loading-overlay">
			<span class="loading-spinner">⚔️</span>
			<p>バトルちゅう...</p>
		</div>
	{/if}
</div>

<style>
	.battle-page {
		padding: 1rem;
		min-height: 100dvh;
		background: var(--color-surface-base);
	}
	.page-title {
		text-align: center;
		font-size: 1.3rem;
		font-weight: 800;
		margin: 0 0 1rem;
		color: var(--color-text-primary);
	}
	.no-battle {
		text-align: center;
		padding: 2rem;
		color: var(--color-text-secondary);
	}
	.loading-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
		z-index: 100;
		color: white;
		font-size: 1.2rem;
		font-weight: 700;
	}
	.loading-spinner {
		font-size: 3rem;
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.2); }
	}
</style>
