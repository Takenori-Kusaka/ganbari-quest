<script lang="ts">
import type { Snippet } from 'svelte';
import Menu, { type MenuItem } from '$lib/ui/primitives/Menu.svelte';

/**
 * AdminResourceHeader (#2998 / EPIC #2897) — admin リソース管理画面の共通ヘッダー。
 *
 * 活動管理 / チェックリスト管理 / ごほうび管理 は同じ「admin リソース管理画面」だが、
 * 旧実装ではヘッダー構造がバラバラ (活動=ActivitiesHeader 独立 component / checklists・rewards=inline)
 * で、顧客が画面ごとに操作を学び直す必要があった (NN/G #4 consistency 違反、PO 再三指摘)。
 *
 * 本 component は 3 画面共通の正準レイアウトを 1 箇所に集約する (DESIGN.md §5 / §10):
 *   ┌─────────────────────────────────────────────┐
 *   │ <title>            [+ 追加 ▾]  [︙]            │
 *   │ <description>                                 │
 *   └─────────────────────────────────────────────┘
 *
 * - **title / description**: リソース名 + 1 行説明 (各画面が props で渡す)
 * - **+ 追加 dropdown**: 手動 / AI で提案 / みんなのテンプレートから探す … を集約
 *   (DESIGN.md §10 Hick's Law / add 経路 ≤ 4 / Notion・Linear の `+` パターン)。
 *   AI 提案は dropdown 内の選択肢 → Dialog 起動に統一し、本文直置きしない。
 * - **︙ overflow menu**: 復元 / エクスポート / 全削除 等の補助操作 (任意)
 *
 * 各画面は `addMenuItems` / `overflowItems` を props で渡して item の中身を構成するが、
 * **レイアウト (要素集合・配置)** は本 component が SSOT として固定する。これにより
 * 「3 画面のヘッダー要素集合が同一」を構造的に保証する (#2998 AC2 / AC6)。
 *
 * `?` ページガイド trigger は AdminLayout 側 (全 admin 共通) が担うため本 component scope 外。
 *
 * 関連: ActivitiesHeader.svelte (本 component を内包する thin wrapper に縮約)
 */

interface Props {
	/** リソース名見出し (例: 活動管理 / チェックリスト管理 / ごほうび管理) */
	title: string;
	/** 1 行説明文 (任意、title 直下に表示) */
	description?: string;
	/** 「+ 追加」dropdown の menu item 配列 (手動 / AI / browse … を各画面が構成) */
	addMenuItems: MenuItem[];
	/** 「+ 追加」trigger のラベル (既定: '+ 追加') */
	addButtonLabel?: string;
	/** 「+ 追加」trigger の aria-label */
	addMenuAriaLabel: string;
	/** 「+ 追加」trigger の testid (画面固有、E2E 互換) */
	addMenuTestid: string;
	/** 「+ 追加」trigger の data-tutorial (任意) */
	addMenuDataTutorial?: string;
	/** 「+ 追加」trigger を無効化 (上限到達時など) */
	addDisabled?: boolean;
	/** ︙ overflow menu の item 配列 (任意。空配列なら ︙ を出さない) */
	overflowItems?: MenuItem[];
	/** ︙ overflow trigger のラベル (既定: '︙') */
	overflowTriggerLabel?: string;
	/** ︙ overflow trigger の aria-label */
	overflowMenuAriaLabel?: string;
	/** ︙ overflow trigger の testid */
	overflowMenuTestid?: string;
	/**
	 * ︙ overflow を独自 primitive (OverflowMenu 等) で描画したい画面用の slot。
	 * 指定すると `overflowItems` (内蔵 Menu) より優先される。既存 E2E testid を保つため、
	 * checklists のように `OverflowMenu` primitive を使うページはこちらに渡す。
	 */
	overflowSnippet?: Snippet;
	/** title 横に差し込む追加要素 (PremiumBadge / pending badge など) */
	badge?: Snippet;
	/** toolbar (右側 + 追加 / ︙ の並び) に差し込む追加 trigger (任意、+ 追加 の前に表示) */
	toolbarLeading?: Snippet;
}

let {
	title,
	description,
	addMenuItems,
	addButtonLabel = '+ 追加',
	addMenuAriaLabel,
	addMenuTestid,
	addMenuDataTutorial,
	addDisabled = false,
	overflowItems = [],
	overflowTriggerLabel = '︙',
	overflowMenuAriaLabel,
	overflowMenuTestid,
	overflowSnippet,
	badge,
	toolbarLeading,
}: Props = $props();
</script>

<header class="admin-resource-header">
	<div class="admin-resource-header__meta">
		<div class="admin-resource-header__title-row">
			<h2 class="admin-resource-header__title">{title}</h2>
			{#if badge}{@render badge()}{/if}
		</div>
		{#if description}
			<p class="admin-resource-header__desc">{description}</p>
		{/if}
	</div>
	<div class="admin-resource-header__toolbar">
		{#if toolbarLeading}{@render toolbarLeading()}{/if}
		<!-- + 追加 dropdown (DESIGN.md §10 add 経路 ≤ 4 集約、Notion / Linear `+` パターン) -->
		<Menu
			items={addMenuItems}
			placement="bottom-end"
			ariaLabel={addMenuAriaLabel}
			testid={addMenuTestid}
			triggerClass="admin-resource-header__add-btn"
			triggerLabel={addButtonLabel}
			dataTutorial={addMenuDataTutorial}
			disabled={addDisabled}
		/>
		<!-- ︙ overflow menu (補助操作、任意)。独自 primitive 利用時は overflowSnippet が優先。 -->
		{#if overflowSnippet}
			{@render overflowSnippet()}
		{:else if overflowItems.length > 0}
			<Menu
				items={overflowItems}
				placement="bottom-end"
				ariaLabel={overflowMenuAriaLabel}
				testid={overflowMenuTestid}
				triggerClass="admin-resource-header__overflow-btn"
				triggerLabel={overflowTriggerLabel}
			/>
		{/if}
	</div>
</header>

<style>
	.admin-resource-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.admin-resource-header__meta {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
		min-width: 0;
	}
	.admin-resource-header__title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.admin-resource-header__title {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}
	.admin-resource-header__desc {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		line-height: 1.4;
	}
	.admin-resource-header__toolbar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}
	/* Menu primitive pass-through requires :global selector for parent scope visibility (#2260 Fix-1) */
	:global(.admin-resource-header__toolbar .admin-resource-header__add-btn) {
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
	:global(.admin-resource-header__toolbar .admin-resource-header__add-btn:hover:not(:disabled)) {
		filter: brightness(0.9);
	}
	:global(.admin-resource-header__toolbar .admin-resource-header__add-btn:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	:global(.admin-resource-header__toolbar .admin-resource-header__overflow-btn) {
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
	:global(.admin-resource-header__toolbar .admin-resource-header__overflow-btn:hover) {
		background: var(--color-surface-muted);
	}
</style>
