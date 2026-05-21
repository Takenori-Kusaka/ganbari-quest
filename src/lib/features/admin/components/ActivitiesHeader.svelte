<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';
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
// #2371 (EPIC #2362 PO 指摘 ③ 物理解消): `introduce` 項目撤去。ヘッダー `?` ボタン (PR #2388 で
// PageGuideOverlay v2 + PageGuideRegistry 経由に統一済) を唯一のガイド経路に統一する。旧
// `/admin/activities/introduce` URL は `legacy-url-map.ts` で `/admin/activities` に 308
// リダイレクトされる (ブックマーク救済)。
const overflowItems = $derived<MenuItem[]>([
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
	</div>
	<div class="activities-toolbar">
		<!-- + 追加 dropdown menu (EPIC #2253 / #2255 / #2260 Fix-1: nested button 解消) -->
		<Menu
			items={addMenuItems}
			placement="bottom-end"
			ariaLabel={L.addMenuAriaLabel}
			testid="header-add-activity-btn"
			triggerClass="add-btn"
			triggerLabel={L.addButtonLabel}
			dataTutorial="add-activity-btn"
			disabled={!canAdd}
		/>
		<!-- ︙ overflow menu (EPIC #2253 / #2257 / #2260 Fix-1) -->
		<Menu
			items={overflowItems}
			placement="bottom-end"
			ariaLabel={L.overflowMenuAriaLabel}
			testid="header-overflow-menu-btn"
			triggerClass="overflow-btn"
			triggerLabel={L.overflowTriggerLabel}
		/>
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
	/* #2260 Fix-1: Menu primitive pass-through requires :global selector for parent scope visibility */
	:global(.activities-toolbar .add-btn) {
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
	:global(.activities-toolbar .add-btn:hover:not(:disabled)) {
		filter: brightness(0.9);
	}
	:global(.activities-toolbar .add-btn:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	:global(.activities-toolbar .overflow-btn) {
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
	:global(.activities-toolbar .overflow-btn:hover) {
		background: var(--color-surface-muted);
	}
</style>
