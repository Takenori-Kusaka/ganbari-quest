<script lang="ts">
import type { BattleResult, BattleStats, Enemy } from '$lib/domain/battle-types';
import { STAT_LABELS } from '$lib/domain/battle-types';
import { FEATURES_LABELS } from '$lib/domain/labels';
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
// svelte-ignore state_referenced_locally
let playerHp = $state(playerStats.hp);
// svelte-ignore state_referenced_locally
let enemyHp = $state(scaledEnemyMaxHp);
let showResult = $state(false);
let playerShake = $state(false);
let enemyShake = $state(false);

// ダメージフロート
let playerDamageFloat = $state<{ value: number; critical: boolean; key: number } | null>(null);
let enemyDamageFloat = $state<{ value: number; critical: boolean; key: number } | null>(null);
let floatCounter = $state(0);

// クリティカルフラッシュ
let criticalFlash = $state(false);

// バトル結果が来たらアニメーション開始
$effect(() => {
	if (battleResult && !animating && !showResult) {
		runAnimation();
	}
});

async function showDamageFloat(
	target: 'player' | 'enemy',
	damage: number,
	critical: boolean,
): Promise<void> {
	const key = ++floatCounter;
	if (target === 'enemy') {
		enemyDamageFloat = { value: damage, critical, key };
	} else {
		playerDamageFloat = { value: damage, critical, key };
	}
	if (critical) {
		criticalFlash = true;
		await sleep(300);
		criticalFlash = false;
	}
	// フロートは 600ms で自然消滅（CSS animation）
	await sleep(620);
	if (target === 'enemy' && enemyDamageFloat?.key === key) {
		enemyDamageFloat = null;
	} else if (target === 'player' && playerDamageFloat?.key === key) {
		playerDamageFloat = null;
	}
}

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
			// プレイヤー攻撃（shake + フロートを並行）
			enemyShake = true;
			// ダメージフロートとshakeを並行実行（総時間を増やさない）
			void showDamageFloat('enemy', turn.playerAction.damage, turn.playerAction.critical);
			await sleep(300);
			enemyHp = turn.enemyHpAfter;
			enemyShake = false;
			await sleep(200);

			// 敵反撃
			if (turn.enemyAction.damage > 0) {
				playerShake = true;
				void showDamageFloat('player', turn.enemyAction.damage, turn.enemyAction.critical);
				await sleep(300);
				playerHp = turn.playerHpAfter;
				playerShake = false;
				await sleep(200);
			}
		} else {
			// 敵先攻
			playerShake = true;
			void showDamageFloat('player', turn.enemyAction.damage, turn.enemyAction.critical);
			await sleep(300);
			playerHp = turn.playerHpAfter;
			playerShake = false;
			await sleep(200);

			// プレイヤー反撃
			if (turn.playerAction.damage > 0) {
				enemyShake = true;
				void showDamageFloat('enemy', turn.playerAction.damage, turn.playerAction.critical);
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

<div class="battle-scene" class:critical-flash={criticalFlash} data-testid="battle-scene">
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
			<div class="sprite-wrap">
				<div class="sprite" class:shake={enemyShake} class:defeated={enemyHp <= 0}>
					<img class="sprite-img" src={enemy.image} alt={enemy.name} />
				</div>
				{#if enemyDamageFloat}
					<span
						class="damage-float"
						class:critical={enemyDamageFloat.critical}
						aria-hidden="true"
					>
						{enemyDamageFloat.critical ? '💥' : ''}{enemyDamageFloat.value}
					</span>
				{/if}
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
				label={FEATURES_LABELS.battle.playerName}
				variant="player"
			/>
			<div class="sprite-wrap">
				<div class="sprite" class:shake={playerShake} class:defeated={playerHp <= 0}>
					<img class="sprite-img" src="/assets/battle/characters/hero-default.png" alt={FEATURES_LABELS.battle.playerSpriteAlt} />
				</div>
				{#if playerDamageFloat}
					<span
						class="damage-float"
						class:critical={playerDamageFloat.critical}
						aria-hidden="true"
					>
						{playerDamageFloat.critical ? '💥' : ''}{playerDamageFloat.value}
					</span>
				{/if}
			</div>
			<div class="combatant-name">{FEATURES_LABELS.battle.playerName}</div>
		</div>
	</div>

	<!-- ステータス表示 -->
	{#if !battleResult && !completed}
		<div class="stats-panel" data-testid="stats-panel">
			<h3 class="stats-title">{FEATURES_LABELS.battle.statsTitle}</h3>
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
				<div class="result-text" data-testid="result-text">{FEATURES_LABELS.battle.resultWin}</div>
				<div class="reward-text" data-testid="reward-text">{FEATURES_LABELS.battle.rewardWin(battleResult.rewardPoints)}</div>
			{:else}
				<div class="result-text" data-testid="result-text">{FEATURES_LABELS.battle.resultLose}</div>
				<div class="reward-text" data-testid="reward-text">{FEATURES_LABELS.battle.rewardLose(battleResult.rewardPoints)}</div>
				<div class="encourage-text">{FEATURES_LABELS.battle.encourageLose}</div>
			{/if}
		</div>
	{/if}

	<!-- アクションボタン -->
	{#if !battleResult && !completed}
		<Button type="submit" size="lg" disabled={animating} class="w-full" data-testid="battle-start-button">
			{FEATURES_LABELS.battle.startBtn}
		</Button>
	{:else if completed && !battleResult}
		<div class="already-done" data-testid="battle-already-done">{FEATURES_LABELS.battle.alreadyDone}</div>
	{/if}
</div>

<style>
	.battle-scene {
		max-width: 480px;
		margin: 0 auto;
		padding: 1rem;
		position: relative;
	}
	/* Improvement C: Critical flash */
	.battle-scene::after {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--color-action-danger);
		opacity: 0;
		pointer-events: none;
		border-radius: 16px;
	}
	.battle-scene.critical-flash::after {
		animation: flash 0.3s ease-out forwards;
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
	/* Improvement A: Damage float wrapper */
	.sprite-wrap {
		position: relative;
		display: inline-block;
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
	/* Improvement C: add transition to defeated state (existing opacity+filter plus translateY) */
	.sprite.defeated {
		opacity: 0.3;
		filter: grayscale(1);
		transform: translateY(8px);
		transition: opacity 0.5s ease, filter 0.5s ease, transform 0.5s ease;
	}
	.combatant-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	/* Improvement A: Damage float */
	.damage-float {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		font-size: 1.1rem;
		font-weight: 900;
		color: var(--color-text-warm);
		pointer-events: none;
		white-space: nowrap;
		animation: damageFloat 0.6s ease-out forwards;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
	}
	.damage-float.critical {
		color: var(--color-action-danger);
		font-size: 1.4rem;
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
			var(--color-action-success) 0%,
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
	/* Improvement A: Damage float animation */
	@keyframes damageFloat {
		0%   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
		30%  { transform: translateX(-50%) translateY(-20px) scale(1.3); }
		100% { opacity: 0; transform: translateX(-50%) translateY(-40px) scale(0.8); }
	}
	/* Improvement C: Critical flash animation */
	@keyframes flash {
		0%   { opacity: 0.25; }
		50%  { opacity: 0.15; }
		100% { opacity: 0; }
	}
</style>
