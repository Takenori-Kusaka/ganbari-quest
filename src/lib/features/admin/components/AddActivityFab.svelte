<script lang="ts">
interface Props {
	enabled: boolean;
	onclick: () => void;
}

let { enabled, onclick }: Props = $props();
</script>

{#if enabled}
	<button
		type="button"
		class="fab"
		data-tutorial="add-activity-btn"
		data-testid="add-activity-fab"
		{onclick}
		aria-label="活動を追加"
	>
		<span class="fab__icon">+</span>
	</button>
{:else}
	<button
		type="button"
		class="fab fab--disabled"
		aria-label="追加上限"
		aria-disabled="true"
		disabled
	>
		<span class="fab__icon">+</span>
	</button>
{/if}

<style>
	.fab {
		position: fixed;
		bottom: calc(var(--bottom-nav-height, 64px) + 1rem);
		right: 1rem;
		z-index: 30;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		background: var(--color-action-primary);
		color: white;
		border: none;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.15s, box-shadow 0.15s;
	}
	.fab:hover {
		transform: scale(1.05);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
	}
	.fab:active {
		transform: scale(0.95);
	}
	.fab--disabled {
		background: var(--color-surface-muted-strong);
		cursor: not-allowed;
		pointer-events: none;
	}
	.fab__icon {
		font-size: 1.75rem;
		font-weight: 300;
		line-height: 1;
	}

	@media (min-width: 768px) {
		.fab {
			bottom: 2rem;
			right: 2rem;
		}
	}
</style>
