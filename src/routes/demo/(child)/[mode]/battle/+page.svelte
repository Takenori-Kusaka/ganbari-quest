<script lang="ts">
import { executeBattle, scaleEnemyStats } from '$lib/domain/battle-engine';
import { getAgeScaling } from '$lib/domain/battle-stat-calculator';
import type { BattleResult } from '$lib/domain/battle-types';
import BattleScene from '$lib/features/battle/BattleScene.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let battleResult = $state<BattleResult | null>(null);
let completed = $state(false);

function handleStartBattle() {
	if (!data.battle || !data.child) return;

	const uiMode = data.child.uiMode ?? 'preschool';
	const isWalkMode = uiMode === 'baby' || uiMode === 'preschool';
	const scaling = getAgeScaling(uiMode);
	const scaledEnemyStats = scaleEnemyStats(data.battle.enemy.stats, scaling);

	const result = executeBattle(data.battle.playerStats, scaledEnemyStats, {
		walkMode: isWalkMode,
	});

	// Assign reward points
	result.rewardPoints =
		result.outcome === 'win' ? data.battle.enemy.dropPoints : data.battle.enemy.consolationPoints;

	battleResult = result;
	completed = true;
}
</script>

<svelte:head>
	<title>バトル - がんばりクエスト デモ</title>
</svelte:head>

<div class="battle-page" data-testid="demo-battle-page">
	<h2 class="page-title">⚔️ きょうの バトル</h2>

	{#if data.battle}
		{#if !completed}
			<div class="start-area">
				<Button variant="primary" size="lg" onclick={handleStartBattle}>
					バトル かいし！
				</Button>
			</div>
		{/if}

		<BattleScene
			enemy={data.battle.enemy}
			playerStats={data.battle.playerStats}
			scaledEnemyMaxHp={data.battle.scaledEnemyMaxHp}
			{battleResult}
			{completed}
		/>

		{#if completed && battleResult}
			<div class="demo-notice">
				<p class="demo-notice-text">
					（デモモード：データは保存されません）
				</p>
				<a
					href="/demo/signup"
					class="signup-link"
				>
					お子さまの名前で はじめる →
				</a>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => { battleResult = null; completed = false; }}
					class="mt-2"
				>
					もういちど あそぶ
				</Button>
			</div>
		{/if}
	{:else}
		<div class="no-battle">
			<p>バトルじょうほうを よみこめませんでした</p>
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
	.start-area {
		text-align: center;
		margin-bottom: 1rem;
	}
	.no-battle {
		text-align: center;
		padding: 2rem;
		color: var(--color-text-secondary);
	}
	.demo-notice {
		text-align: center;
		margin-top: 1rem;
	}
	.demo-notice-text {
		font-size: 0.75rem;
		color: var(--color-feedback-warning-text);
	}
	.signup-link {
		display: block;
		width: 100%;
		max-width: 480px;
		margin: 0.5rem auto 0;
		padding: 0.625rem;
		background: linear-gradient(to right, var(--color-brand-500), var(--color-brand-600));
		color: white;
		font-weight: 700;
		border-radius: var(--radius-lg);
		text-align: center;
		text-decoration: none;
		font-size: 0.875rem;
	}
</style>
