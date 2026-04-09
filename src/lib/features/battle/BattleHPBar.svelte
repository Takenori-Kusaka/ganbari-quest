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
const barColor = $derived(
	pct > 50
		? 'var(--color-status-success, #22c55e)'
		: pct > 20
			? 'var(--color-status-warning, #f59e0b)'
			: 'var(--color-status-error, #ef4444)',
);
</script>

<div class="hp-bar" class:enemy={variant === 'enemy'}>
	<div class="hp-label">
		<span class="hp-name">{label}</span>
		<span class="hp-value">{current}/{max}</span>
	</div>
	<div class="hp-track">
		<div
			class="hp-fill"
			style:width="{pct}%"
			style:background-color={barColor}
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
		color: var(--color-text-primary, #1a1a2e);
	}
	.hp-value {
		color: var(--color-text-secondary, #666);
		font-variant-numeric: tabular-nums;
	}
	.hp-track {
		height: 10px;
		background: var(--color-surface-muted, #e5e7eb);
		border-radius: 5px;
		overflow: hidden;
	}
	.hp-fill {
		height: 100%;
		border-radius: 5px;
		transition: width 0.6s ease-out;
	}
</style>
