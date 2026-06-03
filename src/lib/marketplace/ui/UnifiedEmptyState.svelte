<script lang="ts">
/**
 * UnifiedEmptyState — EPIC #2362 P4 / Issue #2370 / CX-DoR #9・#11 横展開 (Round 18)
 *
 * 5 admin リソース (activities / rewards / checklists / rule-presets / challenges) の
 * empty state を統一する SSOT shell。NN/G #4 consistency (DoR #11 = 3 状態統一) を担保する。
 *
 * 設計原則 (DESIGN.md §10 / EPIC #2253 bridge ルール):
 *   - 「○○ がまだありません → 取り込み / 作成で追加」の bridge を必ず提供
 *   - empty state からの secondary link で初期 setup 期の発見性を担保
 *   - header `+` メニュー内 1 階層内アクセスと併存し、運用期の到達性も担保
 *   - secondary link は #2558 段階2/3 以降 admin 内ブラウズ UI でなく /marketplace への画面遷移
 *
 * 文言は `UNIFIED_EMPTY_STATE_LABELS` を既定値とし、各 page が既存ラベルを override props で
 * 渡すことで「視覚回帰ゼロ (文言不変)」のまま本 SSOT shell に統一できる (ADR-0045 SSOT 整合)。
 *
 * secondary link の 2 mode:
 *   - `'callback'` (既定): `onAdd('import')` を呼ぶ <button>。callback 側で goto 等を実行
 *   - `'link'`: `browseHref` を href とする <a>。SvelteKit 標準遷移 (form 不要 page で使用)
 *
 * 関連:
 *   - ADR-0052 (MarketplaceTypeRegistry)
 *   - EPIC #2253 / Issue #2256 (admin-activities add UX bridge)
 */

import { UNIFIED_EMPTY_STATE_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

type Mode = 'manual' | 'import';

interface Props {
	/** リソース表示名（「活動」「ごほうび」「チェックリスト」「ルール」「チャレンジ」）。noItemsText 未指定時の自動文言に使用 */
	resourceName?: string;
	/** フィルタ／検索で空になっている場合 true（その場合 import link は出さない） */
	hasFilter?: boolean;
	/** 追加可能か（plan 制限・権限） */
	canAdd?: boolean;
	/** import 経路があるか（type に依らず両 mode の提供制御） */
	canImport?: boolean;
	/** mode 選択時の callback（secondaryMode='callback' 時の import / primary の manual 共通） */
	onAdd?: (mode: Mode) => void;
	/** ルート要素の data-testid（page 既存 testid 互換のため override 可能。既定 'unified-empty-state'） */
	testid?: string;
	/** secondary import link の data-testid（page 既存 testid 互換。既定 'unified-empty-state-import-link'） */
	importTestid?: string;
	/** アイコン override（既定 UNIFIED_EMPTY_STATE_LABELS.icon = 📋） */
	icon?: string;
	/** 「○○ がまだありません」本文 override（page 既存文言で視覚回帰ゼロ化） */
	noItemsText?: string;
	/** 本文の下に表示する補足説明（rules / challenges のように title + desc 2 行構成の page 用、任意） */
	descText?: string;
	/** filter 結果空メッセージ override */
	filteredText?: string;
	/** primary CTA ラベル override（既定 UNIFIED_EMPTY_STATE_LABELS.addBtn） */
	addBtnLabel?: string;
	/** secondary import link ラベル override（既定 UNIFIED_EMPTY_STATE_LABELS.importBtn） */
	importLinkLabel?: string;
	/** secondary link の挙動。'callback' = onAdd('import') / 'link' = browseHref へ遷移 */
	secondaryMode?: 'callback' | 'link';
	/** secondaryMode='link' 時の遷移先（例 '/marketplace?type=checklist'） */
	browseHref?: string;
	/** primary CTA を出すか（rewards のように filter-only empty で CTA 不要な場合 false） */
	showPrimary?: boolean;
}

let {
	resourceName = '',
	hasFilter = false,
	canAdd = true,
	canImport = true,
	onAdd,
	testid = 'unified-empty-state',
	importTestid = 'unified-empty-state-import-link',
	icon,
	noItemsText,
	descText,
	filteredText,
	addBtnLabel,
	importLinkLabel,
	secondaryMode = 'callback',
	browseHref,
	showPrimary = true,
}: Props = $props();

const resolvedIcon = $derived(icon ?? UNIFIED_EMPTY_STATE_LABELS.icon);
const resolvedNoItems = $derived(noItemsText ?? UNIFIED_EMPTY_STATE_LABELS.noItems(resourceName));
const resolvedFiltered = $derived(filteredText ?? UNIFIED_EMPTY_STATE_LABELS.filteredText);
const resolvedAddBtn = $derived(addBtnLabel ?? UNIFIED_EMPTY_STATE_LABELS.addBtn);
const resolvedImportBtn = $derived(importLinkLabel ?? UNIFIED_EMPTY_STATE_LABELS.importBtn);

function handleManual() {
	onAdd?.('manual');
}
function handleImport() {
	onAdd?.('import');
}
</script>

<div class="unified-empty-state" data-testid={testid}>
	<p class="empty-icon">{resolvedIcon}</p>
	<p class="empty-text">
		{hasFilter ? resolvedFiltered : resolvedNoItems}
	</p>
	{#if descText && !hasFilter}
		<p class="empty-desc">{descText}</p>
	{/if}

	{#if canAdd && !hasFilter}
		<div class="empty-actions">
			{#if showPrimary}
				<Button
					variant="primary"
					size="sm"
					onclick={handleManual}
					data-testid="unified-empty-state-add-manual"
				>
					{resolvedAddBtn}
				</Button>
			{/if}
			{#if canImport}
				<!-- bulk import bridge link (EPIC #2253 / DESIGN.md §10) -->
				{#if secondaryMode === 'link' && browseHref}
					<a
						class="empty-import-link"
						data-testid={importTestid}
						href={browseHref}
					>
						{resolvedImportBtn}
					</a>
				{:else}
					<button
						type="button"
						class="empty-import-link"
						data-testid={importTestid}
						onclick={handleImport}
					>
						{resolvedImportBtn}
					</button>
				{/if}
			{/if}
		</div>
	{:else if canAdd && hasFilter && showPrimary}
		<Button
			variant="primary"
			size="sm"
			onclick={handleManual}
			data-testid="unified-empty-state-add-manual"
		>
			{resolvedAddBtn}
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
	.empty-desc {
		font-size: 0.75rem;
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
