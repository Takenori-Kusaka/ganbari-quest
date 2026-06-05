<script lang="ts">
import { Menu as ArkMenu } from '@ark-ui/svelte/menu';
import { Portal } from '@ark-ui/svelte/portal';

/**
 * OverflowMenu primitive (EPIC #2362 PR-2)
 *
 * admin route (activity / reward / challenge / checklist / rule bonus) 共通の
 * top-right ⋮ overflow menu。Ark UI Menu wrapper で標準 7 項目 (marketplace /
 * ai / divider / restore / export / divider / help) を SSOT 集約。
 *
 * 各 menu item は items props で受け取り、admin route ごとに ON/OFF / 並び替え
 * 可能 (Pure presentation、SRP)。divider 表現は { divider: true } で個別 item
 * として渡す (Composition over Inheritance)。
 *
 * UX 規約 (User 合意済 2026-05-23 §6.1):
 *   🏪 みんなのテンプレから取込
 *   🤖 AI で提案してもらう (Help と並ぶ「便利機能」レイヤ)
 *   ──────────
 *   ⬇ バックアップから復元
 *   ⬆ エクスポート
 *   ──────────
 *   ❓ このページのヘルプ
 *
 * DESIGN.md §5 primitive、§10 z-index (`--z-dropdown` = 20) 整合。
 *
 * 用途上の注意:
 * - inline 値選択 (form field) には Select.svelte を使う
 * - 操作確認には Dialog.svelte を使う
 * - card 行内の編集 / 削除 menu には Menu.svelte (汎用 dropdown) を使う
 *   本 primitive は admin route header の overflow menu 用途専用
 */

/**
 * Action item (選択可能なメニュー項目) — 'type: action' は省略可能 (default で action 扱い)。
 * QM Re-Review feedback (2026-05-23): silent skip の無効値を構造的に許容しないため
 * discriminated union 化。invalid item は TypeScript 型チェック時点で fail loud する。
 */
export interface OverflowMenuActionItem {
	type?: 'action';
	/** ユニーク ID (typeahead / test に使う) */
	id: string;
	/** 表示ラベル */
	label: string;
	/** 任意の prefix icon (絵文字 1 文字推奨) */
	icon?: string;
	/** 選択時のハンドラ */
	onSelect: () => void;
	/** 無効化 */
	disabled?: boolean;
}

/** Divider item (区切り線) — 'type: divider' 必須。label / onSelect は持たない。 */
export interface OverflowMenuDividerItem {
	type: 'divider';
	/** ユニーク ID (Svelte each key 用、test に使う) */
	id: string;
}

/**
 * Discriminated union: action か divider のいずれか必須。
 * action item は 'type: action' 省略可能 (default、既存呼出側との互換維持)。
 * divider item は 'type: divider' 必須。
 *
 * QM Re-Review (2026-05-23): 旧 optional fields 版は invalid item を silent skip して
 * いたが、PR-3〜7 で 5+ 箇所から呼ばれる primitive で silent skip は debug 不能。
 * 型レベルで invalid を排除する。
 */
export type OverflowMenuItem = OverflowMenuActionItem | OverflowMenuDividerItem;

type Placement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';

interface Props {
	/** menu item 配列 (divider 含む順序のまま描画) */
	items: OverflowMenuItem[];
	/** trigger button の aria-label (open ボタンの説明) */
	ariaLabel: string;
	/** menu placement (Ark UI positioning.placement) */
	placement?: Placement;
	/** 任意の testid (trigger button に付与) */
	testid?: string;
	/** trigger button の disabled */
	disabled?: boolean;
}

let { items, ariaLabel, placement = 'bottom-end', testid, disabled = false }: Props = $props();

/** type narrowing helper: divider かどうか (Svelte 5 markup から呼ぶ) */
function isDivider(item: OverflowMenuItem): item is OverflowMenuDividerItem {
	return item.type === 'divider';
}
</script>

<ArkMenu.Root positioning={{ placement }}>
	<ArkMenu.Trigger
		class="overflow-menu-trigger"
		aria-label={ariaLabel}
		data-testid={testid}
		{disabled}
	>
		<span aria-hidden="true">⋮</span>
	</ArkMenu.Trigger>
	<Portal>
		<ArkMenu.Positioner class="overflow-menu-positioner">
			<ArkMenu.Content class="overflow-menu-content">
				{#each items as item (item.id)}
					{#if isDivider(item)}
						<div class="overflow-menu-divider" role="separator" aria-hidden="true"></div>
					{:else}
						<ArkMenu.Item
							value={item.id}
							disabled={item.disabled}
							onSelect={item.onSelect}
							class="overflow-menu-item"
							data-testid="overflow-menu-item-{item.id}"
						>
							{#if item.icon}
								<span class="overflow-menu-item__icon" aria-hidden="true">{item.icon}</span>
							{/if}
							<span class="overflow-menu-item__label">{item.label}</span>
						</ArkMenu.Item>
					{/if}
				{/each}
			</ArkMenu.Content>
		</ArkMenu.Positioner>
	</Portal>
</ArkMenu.Root>

<style>
	:global(.overflow-menu-trigger) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		min-width: 44px;
		min-height: 44px;
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
		border: none;
		transition: background 0.1s;
	}

	:global(.overflow-menu-trigger:hover) {
		background: var(--color-surface-muted);
	}

	:global(.overflow-menu-trigger:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.overflow-menu-positioner) {
		z-index: var(--z-dropdown);
	}

	:global(.overflow-menu-content) {
		min-width: 220px;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		padding: 0.25rem;
		outline: none;
	}

	:global(.overflow-menu-item) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 0.9rem;
		color: var(--color-text-primary);
		user-select: none;
		transition: background 0.1s;
		outline: none;
	}

	:global(.overflow-menu-item[data-highlighted]) {
		background: var(--color-surface-muted);
	}

	:global(.overflow-menu-item[data-disabled]) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.overflow-menu-item__icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		font-size: 1.1rem;
		flex-shrink: 0;
	}

	:global(.overflow-menu-item__label) {
		flex: 1;
	}

	:global(.overflow-menu-divider) {
		height: 1px;
		background: var(--color-border-light);
		margin: 0.25rem 0;
	}
</style>
