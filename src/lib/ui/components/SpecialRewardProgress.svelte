<script lang="ts">
interface Props {
	remaining: number;
	interval: number;
}

let { remaining, interval }: Props = $props();

const filled = $derived(interval - remaining);
</script>

<div class="reward-progress" data-testid="special-reward-progress">
	<div class="reward-progress__label">
		{#if remaining === 0}
			<span class="reward-progress__text reward-progress__text--ready">
				🎁 とくべつごほうび！
			</span>
		{:else}
			<span class="reward-progress__text">
				🎁 あと<strong>{remaining}</strong>かいで とくべつごほうび！
			</span>
		{/if}
	</div>
	<div class="reward-progress__bar">
		{#each Array(interval) as _, i}
			<div
				class="reward-progress__dot"
				class:reward-progress__dot--filled={i < filled}
			></div>
		{/each}
	</div>
</div>

<style>
	.reward-progress {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-xs, 4px);
		padding: var(--sp-sm, 8px) var(--sp-md, 12px);
		border-radius: var(--radius-md, 8px);
		background: var(--color-surface-card, #fff);
		border: 1px solid var(--color-border-default, #e0e0e0);
	}

	.reward-progress__label {
		font-size: 0.85rem;
	}

	.reward-progress__text {
		color: var(--color-text-secondary, #666);
	}

	.reward-progress__text--ready {
		color: var(--color-point, #f59e0b);
		font-weight: bold;
	}

	.reward-progress__bar {
		display: flex;
		gap: var(--sp-xs, 4px);
	}

	.reward-progress__dot {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-border-default, #e0e0e0);
		transition: background 0.2s ease;
	}

	.reward-progress__dot--filled {
		background: var(--color-action-primary, #667eea);
	}
</style>
