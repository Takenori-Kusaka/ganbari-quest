<script lang="ts">
import { goto } from '$app/navigation';
import { FEATURES_LABELS } from '$lib/domain/labels';
import PageHelpButton from '$lib/ui/components/PageHelpButton.svelte';
import Menu, { type MenuItem } from '$lib/ui/primitives/Menu.svelte';

type AddMode = 'manual' | 'ai' | 'import';

interface Props {
	onClearAll: () => void;
	clearConfirmOpen: boolean;
	canAdd: boolean;
	onAddSelect: (mode: AddMode) => void;
}

let { onClearAll, clearConfirmOpen, canAdd, onAddSelect }: Props = $props();

const L = FEATURES_LABELS.activitiesHeader;

// + 追加 dropdown menu items (EPIC #2253 / #2255)
const addMenuItems = $derived<MenuItem[]>([
	{
		id: 'manual',
		label: L.addManualLabel,
		icon: L.addManualIcon,
		onSelect: () => onAddSelect('manual'),
	},
	{
		id: 'ai',
		label: L.addAiLabel,
		icon: L.addAiIcon,
		onSelect: () => onAddSelect('ai'),
	},
	{
		id: 'import',
		label: L.addImportLabel,
		icon: L.addImportIcon,
		onSelect: () => onAddSelect('import'),
	},
]);

// ︙ overflow menu items (EPIC #2253 / #2257)
const overflowItems = $derived<MenuItem[]>([
	{
		id: 'introduce',
		label: L.introduceLabel,
		icon: L.introduceIcon,
		onSelect: () => {
			goto('/admin/activities/introduce');
		},
	},
	{
		id: 'export',
		label: L.exportLabel,
		icon: L.exportIcon,
		onSelect: () => {
			// JSON ダウンロード: Content-Disposition: attachment + filename hint で実行
			if (typeof document !== 'undefined') {
				const a = document.createElement('a');
				a.href = '/api/v1/activities/export';
				a.download = 'activities-export.json';
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
			}
		},
	},
	...(clearConfirmOpen
		? []
		: [
				{
					id: 'clear-all',
					label: L.clearAllLabel,
					icon: L.clearAllIcon,
					onSelect: onClearAll,
					danger: true,
				} satisfies MenuItem,
			]),
]);
</script>

<div class="activities-header">
	<div class="flex items-center gap-2">
		<h2 class="activities-title">{L.title}</h2>
		<PageHelpButton />
	</div>
	<div class="activities-toolbar">
		<!-- + 追加 dropdown menu (EPIC #2253 / #2255) -->
		<Menu items={addMenuItems} placement="bottom-end" ariaLabel={L.addMenuAriaLabel}>
			{#snippet trigger()}
				<button
					type="button"
					class="add-btn"
					data-tutorial="add-activity-btn"
					data-testid="header-add-activity-btn"
					aria-label={L.addMenuAriaLabel}
					disabled={!canAdd}
				>
					{L.addButtonLabel}
				</button>
			{/snippet}
		</Menu>
		<!-- ︙ overflow menu (EPIC #2253 / #2257) -->
		<Menu items={overflowItems} placement="bottom-end" ariaLabel={L.overflowMenuAriaLabel}>
			{#snippet trigger()}
				<button
					type="button"
					class="overflow-btn"
					data-testid="header-overflow-menu-btn"
					aria-label={L.overflowMenuAriaLabel}
				>
					{L.overflowTriggerLabel}
				</button>
			{/snippet}
		</Menu>
	</div>
</div>

<style>
	.activities-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.activities-title {
		font-size: 1.125rem;
		font-weight: 700;
	}
	.activities-toolbar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.add-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.4rem 0.85rem;
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
		font-size: 0.875rem;
		font-weight: 700;
		cursor: pointer;
		transition: filter 0.15s;
	}
	.add-btn:hover:not(:disabled) {
		filter: brightness(0.9);
	}
	.add-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.overflow-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		transition: background 0.15s;
		color: var(--color-text-secondary);
	}
	.overflow-btn:hover {
		background: var(--color-surface-muted);
	}
</style>
