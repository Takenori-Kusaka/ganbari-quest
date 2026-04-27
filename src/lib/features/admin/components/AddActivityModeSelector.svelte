<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';

type AddMode = 'ai' | 'manual' | 'import';

interface Props {
	onselect: (mode: AddMode) => void;
}

let { onselect }: Props = $props();

const L = FEATURES_LABELS.addActivityModeSelector;
</script>

<div class="add-mode-grid">
	<button type="button" class="add-mode-card" onclick={() => onselect('ai')}>
		<span class="add-mode-card__icon">✨</span>
		<span class="add-mode-card__label">{L.aiLabel}</span>
		<span class="add-mode-card__desc">{L.aiDesc}</span>
	</button>
	<button type="button" class="add-mode-card" onclick={() => onselect('manual')}>
		<span class="add-mode-card__icon">✏️</span>
		<span class="add-mode-card__label">{L.manualLabel}</span>
		<span class="add-mode-card__desc">{L.manualDesc}</span>
	</button>
	<button type="button" class="add-mode-card" onclick={() => onselect('import')}>
		<span class="add-mode-card__icon">📥</span>
		<span class="add-mode-card__label">{L.importLabel}</span>
		<span class="add-mode-card__desc">{L.importDesc}</span>
	</button>
</div>

<style>
	.add-mode-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	.add-mode-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 1rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.add-mode-card:hover {
		border-color: var(--color-action-primary);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}
	.add-mode-card__icon {
		font-size: 1.5rem;
	}
	.add-mode-card__label {
		font-weight: 700;
		font-size: 0.9rem;
		color: var(--color-text-primary);
	}
	.add-mode-card__desc {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}
</style>
