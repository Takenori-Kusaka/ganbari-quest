<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';
import Menu, { type MenuItem } from '$lib/ui/primitives/Menu.svelte';

// #2558 段階2: 「追加」「一括追加」「別の子からコピー」を 1 つの + 追加メニューに統合。
// `browse` は admin 内ブラウズ UI を撤去し /marketplace へ画面遷移する (PO 方針: マーケットプレイス一本化)。
type AddMode = 'manual' | 'ai' | 'browse' | 'copy' | 'bulk';

interface Props {
	onClearAll: () => void;
	clearConfirmOpen: boolean;
	canAdd: boolean;
	onAddSelect: (mode: AddMode) => void;
	/** #2558 段階2: バックアップから復元ダイアログを開く (旧 UnifiedImportHub file セクション独立化) */
	onRestore: () => void;
	/** #2558 段階2: 「別のお子さまからコピー」は 2 child 以上のときのみ提示 */
	canCopyFromChild: boolean;
}

let { onClearAll, clearConfirmOpen, canAdd, onAddSelect, onRestore, canCopyFromChild }: Props =
	$props();

const L = FEATURES_LABELS.activitiesHeader;

// + 追加 dropdown menu items (EPIC #2253 / #2255 / #2558 段階2 で copy / bulk / browse を統合)
// メニュー構成 (DESIGN.md §10 Hick's Law / add 経路 ≤ 4 整合、browse は marketplace 一本化のため別カウント):
//   手動で1つ追加 / AI で提案してもらう / みんなのテンプレートから探す / 別のお子さまからコピー / 複数のお子さまにまとめて追加
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
		id: 'browse',
		label: L.addBrowseTemplatesLabel,
		icon: L.addBrowseTemplatesIcon,
		onSelect: () => onAddSelect('browse'),
	},
	...(canCopyFromChild
		? [
				{
					id: 'copy',
					label: L.addCopyFromChildLabel,
					icon: L.addCopyFromChildIcon,
					onSelect: () => onAddSelect('copy'),
				} satisfies MenuItem,
			]
		: []),
	{
		id: 'bulk',
		label: L.addBulkLabel,
		icon: L.addBulkIcon,
		onSelect: () => onAddSelect('bulk'),
	},
]);

// ︙ overflow menu items (EPIC #2253 / #2257 + #2558 段階2 で restore を独立配置)
// #2371 (EPIC #2362 PO 指摘 ③ 物理解消): `introduce` 項目撤去。ヘッダー `?` ボタン (PR #2388 で
// PageGuideOverlay v2 + PageGuideRegistry 経由に統一済) を唯一のガイド経路に統一する。旧
// `/admin/activities/introduce` URL は `legacy-url-map.ts` で `/admin/activities` に 308
// リダイレクトされる (ブックマーク救済)。
// #2558 段階2: マーケットプレイスとは別概念の「バックアップから復元」を overflow menu に独立配置。
const overflowItems = $derived<MenuItem[]>([
	{
		id: 'restore',
		label: L.restoreLabel,
		icon: L.restoreIcon,
		onSelect: onRestore,
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
