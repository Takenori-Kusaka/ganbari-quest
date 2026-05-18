<script lang="ts">
import { Menu as ArkMenu } from '@ark-ui/svelte/menu';
import { Portal } from '@ark-ui/svelte/portal';
import type { Snippet } from 'svelte';

/**
 * Menu primitive (#2254 / EPIC #2253)
 *
 * Ark UI Menu の Svelte 5 Runes ラッパ。click trigger + dropdown 配置で
 * manual / ai / import 等の action menu 用途 (子 ② header `+` dropdown / 子 ④ `︙` overflow)。
 *
 * DESIGN.md §5 primitive、§10 z-index トークン (`--z-dropdown` = 20) 整合。
 *
 * 用途上の注意:
 * - 値選択 (form field 連動) には Select.svelte を使う
 * - 操作確認には Dialog.svelte を使う
 * - submenu / context menu / checkbox menu item は本 primitive scope 外 (将来別 props で追加可能)
 */

export interface MenuItem {
	/** ユニーク ID (value/typeahead/test に使う) */
	id: string;
	/** 表示ラベル */
	label: string;
	/** 任意の prefix icon (絵文字 / SVG component を string で渡せる文字のみ) */
	icon?: string;
	/** 選択時のハンドラ */
	onSelect: () => void;
	/** danger 強調 (削除等の取り消し不可能操作) */
	danger?: boolean;
	/** 無効化 */
	disabled?: boolean;
}

type Placement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';

interface Props {
	/** trigger ノード (anchor button 等を render する) */
	trigger: Snippet;
	/** menu item 配列 */
	items: MenuItem[];
	/** menu placement (Ark UI positioning.placement) */
	placement?: Placement;
	/** menu Trigger に付与する aria-label (open ボタンの説明) */
	ariaLabel?: string;
	/** 任意の testid (Trigger 要素に付与) */
	testid?: string;
}

let { trigger, items, placement = 'bottom-end', ariaLabel, testid }: Props = $props();
</script>

<ArkMenu.Root positioning={{ placement }}>
	<ArkMenu.Trigger
		class="menu-trigger-wrapper"
		aria-label={ariaLabel}
		data-testid={testid}
	>
		{@render trigger()}
	</ArkMenu.Trigger>
	<Portal>
		<ArkMenu.Positioner class="menu-positioner">
			<ArkMenu.Content class="menu-content">
				{#each items as item (item.id)}
					<ArkMenu.Item
						value={item.id}
						disabled={item.disabled}
						onSelect={item.onSelect}
						class="menu-item {item.danger ? 'menu-item--danger' : ''}"
						data-testid="menu-item-{item.id}"
					>
						{#if item.icon}
							<span class="menu-item__icon" aria-hidden="true">{item.icon}</span>
						{/if}
						<span class="menu-item__label">{item.label}</span>
					</ArkMenu.Item>
				{/each}
			</ArkMenu.Content>
		</ArkMenu.Positioner>
	</Portal>
</ArkMenu.Root>

<style>
	:global(.menu-trigger-wrapper) {
		display: inline-flex;
	}

	:global(.menu-positioner) {
		/* DESIGN.md section 10: --z-dropdown = 20 token (no raw z-index) */
		z-index: var(--z-dropdown);
	}

	:global(.menu-content) {
		min-width: 180px;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		padding: 0.25rem;
		outline: none;
	}

	:global(.menu-item) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 0.875rem;
		color: var(--color-text-primary);
		user-select: none;
		transition: background 0.1s;
		outline: none;
	}

	:global(.menu-item[data-highlighted]) {
		background: var(--color-surface-muted);
	}

	:global(.menu-item[data-disabled]) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.menu-item--danger) {
		color: var(--color-action-danger);
	}

	:global(.menu-item--danger[data-highlighted]) {
		background: var(--color-feedback-error-bg);
	}

	:global(.menu-item__icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		font-size: 1rem;
		flex-shrink: 0;
	}

	:global(.menu-item__label) {
		flex: 1;
	}
</style>
