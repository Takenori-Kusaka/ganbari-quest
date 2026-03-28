<script lang="ts">
import type { CareerField } from '../types';

let {
	fields,
	selectedId = $bindable(null),
	onselect,
}: {
	fields: CareerField[];
	selectedId: number | null;
	onselect?: (field: CareerField) => void;
} = $props();

function handleSelect(field: CareerField) {
	selectedId = field.id;
	onselect?.(field);
}
</script>

<div class="career-field-grid">
	{#each fields as field}
		<button
			class="career-field-card"
			class:selected={selectedId === field.id}
			onclick={() => handleSelect(field)}
		>
			<span class="career-field-icon">{field.icon ?? '💼'}</span>
			<span class="career-field-name">{field.name}</span>
		</button>
	{/each}
</div>

<style>
	.career-field-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--sp-sm);
	}
	.career-field-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-xs);
		padding: var(--sp-sm);
		border-radius: var(--radius-md);
		border: 2px solid var(--color-border, #e5e7eb);
		background: white;
		cursor: pointer;
		transition: all 0.2s;
	}
	.career-field-card:hover {
		border-color: var(--color-primary, #6366f1);
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}
	.career-field-card.selected {
		border-color: var(--color-primary, #6366f1);
		background: var(--color-primary-light, #eef2ff);
	}
	.career-field-icon {
		font-size: 2rem;
	}
	.career-field-name {
		font-size: var(--font-sm);
		font-weight: 600;
		text-align: center;
		word-break: keep-all;
	}
</style>
