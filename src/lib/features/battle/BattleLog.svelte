<script lang="ts">
import type { BattleTurnLog } from '$lib/domain/battle-types';

let {
	turns,
	currentTurn = 0,
}: {
	turns: BattleTurnLog[];
	currentTurn?: number;
} = $props();

function actionText(action: BattleTurnLog['playerAction'], isPlayer: boolean): string {
	const who = isPlayer ? 'きみ' : 'てき';
	if (action.damage === 0) return `${who}は たおれた…`;
	const crit = action.critical ? 'かいしんの いちげき！ ' : '';
	return `${crit}${who}の こうげき！ ${action.damage} ダメージ`;
}
</script>

<div class="battle-log">
	{#each turns.slice(0, currentTurn) as turn (turn.turn)}
		<div class="turn-entry" class:latest={turn.turn === currentTurn}>
			<span class="turn-number">ターン{turn.turn}</span>
			{#if turn.firstAttacker === 'player'}
				<p class="log-line player">{actionText(turn.playerAction, true)}</p>
				{#if turn.enemyAction.damage > 0 || turn.enemyHpAfter > 0}
					<p class="log-line enemy">{actionText(turn.enemyAction, false)}</p>
				{/if}
			{:else}
				<p class="log-line enemy">{actionText(turn.enemyAction, false)}</p>
				{#if turn.playerAction.damage > 0 || turn.playerHpAfter > 0}
					<p class="log-line player">{actionText(turn.playerAction, true)}</p>
				{/if}
			{/if}
		</div>
	{/each}
</div>

<style>
	.battle-log {
		max-height: 160px;
		overflow-y: auto;
		padding: 0.5rem;
		background: var(--color-surface-sunken, #f3f4f6);
		border-radius: 8px;
		font-size: 0.8rem;
	}
	.turn-entry {
		margin-bottom: 0.5rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border-subtle, #e5e7eb);
	}
	.turn-entry:last-child {
		border-bottom: none;
		margin-bottom: 0;
	}
	.turn-entry.latest {
		animation: fadeIn 0.3s ease-in;
	}
	.turn-number {
		font-weight: 700;
		font-size: 0.7rem;
		color: var(--color-text-tertiary, #999);
	}
	.log-line {
		margin: 2px 0;
		padding-left: 0.5rem;
	}
	.log-line.player {
		color: var(--color-action-primary, #667eea);
	}
	.log-line.enemy {
		color: var(--color-status-error, #ef4444);
	}
	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
