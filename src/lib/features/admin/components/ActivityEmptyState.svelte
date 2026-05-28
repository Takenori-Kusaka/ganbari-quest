<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

// #2558 段階2: secondary link は admin 内ブラウズ UI でなく /marketplace への遷移 (`browse`)
type AddMode = 'manual' | 'browse';

interface Props {
	hasFilter: boolean;
	canAdd: boolean;
	onAdd: (mode: AddMode) => void;
}

let { hasFilter, canAdd, onAdd }: Props = $props();

const L = FEATURES_LABELS.activityEmptyState;
</script>

<div class="empty-state">
	<p class="empty-state__icon">📋</p>
	<p class="empty-state__text">
		{hasFilter ? L.filteredText : L.noActivities}
	</p>
	{#if canAdd && !hasFilter}
		<Button variant="primary" size="sm" onclick={() => onAdd('manual')}>
			{L.addBtn}
		</Button>
		<!-- bulk import bridge (EPIC #2253 / #2256、#2558 段階2 で /marketplace 遷移に統一) -->
		<button
			type="button"
			class="empty-state__import-link"
			data-testid="empty-state-import-link"
			onclick={() => onAdd('browse')}
		>
			{L.secondaryImportLink}
		</button>
	{:else if canAdd && hasFilter}
		<Button variant="primary" size="sm" onclick={() => onAdd('manual')}>
			{L.addBtn}
		</Button>
	{/if}
</div>

<style>
	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
	}
	.empty-state__icon {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}
	.empty-state__text {
		font-size: 0.875rem;
		color: var(--color-text-tertiary);
		margin-bottom: 0.75rem;
	}
	.empty-state__import-link {
		display: inline-block;
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-text-link);
		background: transparent;
		border: none;
		text-decoration: underline;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
	}
	.empty-state__import-link:hover {
		filter: brightness(0.85);
	}
</style>
