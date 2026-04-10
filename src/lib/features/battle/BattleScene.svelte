<script lang="ts">
import type { BattleResult, BattleStats, Enemy } from '$lib/domain/battle-types';
import { STAT_LABELS } from '$lib/domain/battle-types';
import Button from '$lib/ui/primitives/Button.svelte';
import BattleHPBar from './BattleHPBar.svelte';
import BattleLog from './BattleLog.svelte';

let {
	enemy,
	playerStats,
	scaledEnemyMaxHp,
	battleResult = null,
	completed = false,
}: {
	enemy: Enemy;
	playerStats: BattleStats;
	scaledEnemyMaxHp: number;
	battleResult: BattleResult | null;
	completed: boolean;
} = $props();

// バトルアニメーション状態
let animating = $state(false);
let currentTurn = $state(0);
let playerHp = $state(playerStats.hp);
let enemyHp = $state(scaledEnemyMaxHp);
let showResult = $state(false);
let playerShake = $state(false);
let enemyShake = $state(false);

// バトル結果が来たらアニメーション開始
$effect(() => {
	if (battleResult && !animating && !showResult) {
		runAnimation();
	}
});

async function runAnimation() {
	if (!battleResult) return;
	animating = true;
	currentTurn = 0;
	playerHp = playerStats.hp;
	enemyHp = battleResult.turns[0]
		? battleResult.turns[0].firstAttacker === 'player'
			? scaledEnemyMaxHp
			: scaledEnemyMaxHp
		: scaledEnemyMaxHp;

	for (const turn of battleResult.turns) {
		currentTurn = turn.turn;

		if (turn.firstAttacker === 'player') {
			// プレイヤー攻撃
			enemyShake = true;
			await sleep(300);
			enemyHp = turn.enemyHpAfter;
			enemyShake = false;
			await sleep(200);

			// 敵反撃
			if (turn.enemyAction.damage > 0) {
				playerShake = true;
				await sleep(300);
				playerHp = turn.playerHpAfter;
				playerShake = false;
				await sleep(200);
			}
		} else {
			// 敵先攻
			playerShake = true;
			await sleep(300);
			playerHp = turn.playerHpAfter;
			playerShake = false;
			await sleep(200);

			// プレイヤー反撃
			if (turn.playerAction.damage > 0) {
				enemyShake = true;
				await sleep(300);
				enemyHp = turn.enemyHpAfter;
				enemyShake = false;
				await sleep(200);
			}
		}
		await sleep(400);
	}

	animating = false;
	showResult = true;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

const statEntries = $derived(Object.entries(playerStats) as [keyof BattleStats, number][]);
</script>

<div class="battle-scene" data-testid="battle-scene">
	<!-- バトルフィールド -->
	<div class="battle-field" data-testid="battle-field">
		<!-- 敵サイド -->
		<div class="combatant enemy-side" data-testid="enemy-side">
			<BattleHPBar
				current={enemyHp}
				max={scaledEnemyMaxHp}
				label={enemy.name}
				variant="enemy"
			/>
			<div class="sprite" class:shake={enemyShake} class:defeated={enemyHp <= 0}>
				<img class="sprite-img" src={enemy.image} alt={enemy.name} />
			</div>
			<div class="combatant-name" data-testid="enemy-name">{enemy.name}</div>
		</div>

		<!-- VS 表示 -->
		<div class="vs-label">VS</div>

		<!-- プレイヤーサイド -->
		<div class="combatant player-side" data-testid="player-side">
			<BattleHPBar
				current={playerHp}
				max={playerStats.hp}
				label="きみ"
				variant="player"
			/>
			<div class="sprite" class:shake={playerShake} class:defeated={playerHp <= 0}>
				<img class="sprite-img" src="/assets/battle/characters/hero-default.png" alt="きみ" />
			</div>
			<div class="combatant-name">きみ</div>
		</div>
	</div>

	<!-- ステータス表示 -->
	{#if !battleResult && !completed}
		<div class="stats-panel" data-testid="stats-panel">
			<h3 class="stats-title">きみのステータス</h3>
			<div class="stats-grid">
				{#each statEntries as [stat, value]}
					<div class="stat-item">
						<span class="stat-label">{STAT_LABELS[stat]}</span>
						<span class="stat-value">{value}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- バトルログ -->
	{#if battleResult}
		<BattleLog turns={battleResult.turns} {currentTurn} />
	{/if}

	<!-- 結果表示 -->
	{#if showResult && battleResult}
		<div class="result-banner" class:win={battleResult.outcome === 'win'} class:lose={battleResult.outcome === 'lose'} data-testid="battle-result">
			{#if battleResult.outcome === 'win'}
				<div class="result-text" data-testid="result-text">🎉 かった！</div>
				<div class="reward-text" data-testid="reward-text">+{battleResult.rewardPoints}ポイント</div>
			{:else}
				<div class="result-text" data-testid="result-text">😢 まけちゃった…</div>
				<div class="reward-text" data-testid="reward-text">+{battleResult.rewardPoints}ポイント（なぐさめ）</div>
				<div class="encourage-text">つぎは かてるよ！ がんばろう！</div>
			{/if}
		</div>
	{/if}

	<!-- アクションボタン -->
	{#if !battleResult && !completed}
		<Button type="submit" size="lg" disabled={animating} class="w-full" data-testid="battle-start-button">
			⚔️ バトル かいし！
		</Button>
	{:else if completed && !battleResult}
		<div class="already-done" data-testid="battle-already-done">きょうの バトルは おわったよ！</div>
	{/if}
</div>

<style>
	.battle-scene {
		max-width: 480px;
		margin: 0 auto;
		padding: 1rem;
	}
	.battle-field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding: 1rem;
		background: url('/assets/battle/backgrounds/meadow.png') center / cover no-repeat;
		border-radius: 16px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		position: relative;
	}
	.combatant {
		flex: 1;
		text-align: center;
	}
	.vs-label {
		font-size: 1.5rem;
		font-weight: 900;
		color: var(--color-text-tertiary);
		flex-shrink: 0;
	}
	.sprite {
		margin: 0.5rem 0;
		transition: all 0.3s ease;
	}
	.sprite-img {
		width: 96px;
		height: 96px;
		object-fit: contain;
		display: block;
		margin: 0 auto;
	}
	.sprite.shake {
		animation: shake 0.3s ease-in-out;
	}
	.sprite.defeated {
		opacity: 0.3;
		filter: grayscale(1);
		transform: translateY(8px);
		transition: all 0.5s ease;
	}
	.combatant-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.stats-panel {
		background: var(--color-surface-card);
		border-radius: 12px;
		padding: 0.75rem;
		margin-bottom: 1rem;
	}
	.stats-title {
		font-size: 0.85rem;
		font-weight: 700;
		margin: 0 0 0.5rem;
		color: var(--color-text-primary);
	}
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 0.25rem;
		text-align: center;
	}
	.stat-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.stat-label {
		font-size: 0.65rem;
		color: var(--color-text-tertiary);
	}
	.stat-value {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.result-banner {
		text-align: center;
		padding: 1.5rem 1rem;
		border-radius: 16px;
		margin: 1rem 0;
		animation: fadeIn 0.5s ease;
	}
	.result-banner.win {
		background: linear-gradient(
			135deg,
			var(--color-status-success) 0%,
			var(--color-brand-400) 100%
		);
		color: white;
	}
	.result-banner.lose {
		background: var(--color-surface-muted);
		color: var(--color-text-primary);
	}
	.result-text {
		font-size: 1.5rem;
		font-weight: 900;
	}
	.reward-text {
		font-size: 1rem;
		font-weight: 600;
		margin-top: 0.5rem;
	}
	.encourage-text {
		font-size: 0.85rem;
		margin-top: 0.5rem;
		opacity: 0.8;
	}

	.already-done {
		text-align: center;
		padding: 1rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		border-radius: 12px;
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		20% { transform: translateX(-6px); }
		40% { transform: translateX(6px); }
		60% { transform: translateX(-4px); }
		80% { transform: translateX(4px); }
	}
	@keyframes fadeIn {
		from { opacity: 0; transform: scale(0.9); }
		to { opacity: 1; transform: scale(1); }
	}
</style>
