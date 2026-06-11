<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';
import AdminResourceHeader from '$lib/features/admin/components/AdminResourceHeader.svelte';
import type { MenuItem } from '$lib/ui/primitives/Menu.svelte';

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

// #2998 (EPIC #2897): 本 component は AdminResourceHeader (3 画面共通) の thin wrapper に縮約。
//   ヘッダーのレイアウト (title + 説明 + + 追加 dropdown + ︙ overflow) は AdminResourceHeader が
//   SSOT として固定し、本 component は活動固有の menu item 構成のみを担う。
//   既存 testid (header-add-activity-btn / header-overflow-menu-btn) と add menu の順序
//   (manual / ai / browse / [copy] / bulk) は不変 (admin-add-path-isomorphism.spec.ts AC3)。

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

<AdminResourceHeader
	title={L.title}
	addMenuItems={addMenuItems}
	addButtonLabel={L.addButtonLabel}
	addMenuAriaLabel={L.addMenuAriaLabel}
	addMenuTestid="header-add-activity-btn"
	addMenuDataTutorial="add-activity-btn"
	addDisabled={!canAdd}
	overflowItems={overflowItems}
	overflowTriggerLabel={L.overflowTriggerLabel}
	overflowMenuAriaLabel={L.overflowMenuAriaLabel}
	overflowMenuTestid="header-overflow-menu-btn"
/>
