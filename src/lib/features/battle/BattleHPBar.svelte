<script lang="ts">
let {
	current,
	max,
	label,
	variant = 'player',
}: {
	current: number;
	max: number;
	label: string;
	variant?: 'player' | 'enemy';
} = $props();

const pct = $derived(Math.max(0, Math.min(100, (current / max) * 100)));
</script>

<div class="hp-bar" class:enemy={variant === 'enemy'}>
	<div class="hp-label">
		<span class="hp-name">{label}</span>
		<span class="hp-value">{current}/{max}</span>
	</div>
	<div class="hp-track">
		<div
			class="hp-fill"
			class:bar-high={pct > 50}
			class:bar-mid={pct > 20 && pct <= 50}
			class:bar-low={pct <= 20}
			style:width="{pct}%"
		></div>
	</div>
</div>

<style>
	.hp-bar {
		width: 100%;
	}
	.hp-label {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		font-weight: 600;
		margin-bottom: 2px;
	}
	.hp-name {
		color: var(--color-text-primary);
	}
	.hp-value {
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.hp-track {
		height: 10px;
		background: var(--color-surface-muted);
		border-radius: 5px;
		overflow: hidden;
	}
	.hp-fill {
		height: 100%;
		border-radius: 5px;
		transition: width 0.6s ease-out;
	}
	.bar-high {
		background-color: var(--color-action-success);
	}
	.bar-mid {
		background-color: var(--color-action-trial-upgrade);
	}
	.bar-low {
		background-color: var(--color-action-danger);
	}
</style>
