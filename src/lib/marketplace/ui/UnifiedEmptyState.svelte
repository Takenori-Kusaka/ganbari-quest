<script lang="ts">
/**
 * UnifiedEmptyState — EPIC #2362 P4 / Issue #2370
 *
 * 5 admin リソース (activities / rewards / checklists / rule-presets / challenges) の
 * empty state を統一する UI。
 *
 * 設計原則 (DESIGN.md §10 / EPIC #2253 bridge ルール):
 *   - 「○○ がまだありません → 取り込み / 作成で追加」の bridge を必ず提供
 *   - empty state からの secondary link で初期 setup 期の発見性を担保
 *   - header `+` メニュー内 1 階層内アクセスと併存し、運用期の到達性も担保
 *
 * 関連:
 *   - ADR-0052 (MarketplaceTypeRegistry)
 *   - EPIC #2253 / Issue #2256 (admin-activities add UX bridge)
 */

import { UNIFIED_EMPTY_STATE_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

type Mode = 'manual' | 'import';

interface Props {
	/** リソース表示名（「活動」「ごほうび」「チェックリスト」「ルール」「チャレンジ」） */
	resourceName: string;
	/** フィルタ／検索で空になっている場合 true（その場合 import link は出さない） */
	hasFilter?: boolean;
	/** 追加可能か（plan 制限・権限） */
	canAdd?: boolean;
	/** import 経路があるか（type に依らず両 mode の提供制御） */
	canImport?: boolean;
	/** mode 選択時の callback */
	onAdd: (mode: Mode) => void;
}

let { resourceName, hasFilter = false, canAdd = true, canImport = true, onAdd }: Props = $props();
</script>

<div class="unified-empty-state" data-testid="unified-empty-state">
	<p class="empty-icon">{UNIFIED_EMPTY_STATE_LABELS.icon}</p>
	<p class="empty-text">
		{hasFilter
			? UNIFIED_EMPTY_STATE_LABELS.filteredText
			: UNIFIED_EMPTY_STATE_LABELS.noItems(resourceName)}
	</p>

	{#if canAdd && !hasFilter}
		<div class="empty-actions">
			<Button
				variant="primary"
				size="sm"
				onclick={() => onAdd('manual')}
				data-testid="unified-empty-state-add-manual"
			>
				{UNIFIED_EMPTY_STATE_LABELS.addBtn}
			</Button>
			{#if canImport}
				<!-- bulk import bridge link (EPIC #2253 / DESIGN.md §10) -->
				<button
					type="button"
					class="empty-import-link"
					data-testid="unified-empty-state-import-link"
					onclick={() => onAdd('import')}
				>
					{UNIFIED_EMPTY_STATE_LABELS.importBtn}
				</button>
			{/if}
		</div>
	{:else if canAdd && hasFilter}
		<Button
			variant="primary"
			size="sm"
			onclick={() => onAdd('manual')}
			data-testid="unified-empty-state-add-manual"
		>
			{UNIFIED_EMPTY_STATE_LABELS.addBtn}
		</Button>
	{/if}
</div>

<style>
	.unified-empty-state {
		text-align: center;
		padding: 2rem 1rem;
	}
	.empty-icon {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}
	.empty-text {
		font-size: 0.875rem;
		color: var(--color-text-tertiary);
		margin-bottom: 0.75rem;
	}
	.empty-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	.empty-import-link {
		display: inline-block;
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-link);
		background: transparent;
		border: none;
		text-decoration: underline;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
	}
	.empty-import-link:hover {
		filter: brightness(0.85);
	}
</style>
