<script lang="ts">
import { Menu as ArkMenu } from '@ark-ui/svelte/menu';
import { Portal } from '@ark-ui/svelte/portal';
import type { Snippet } from 'svelte';

/**
 * Menu primitive (#2254 / EPIC #2253 / #2260 Fix-1)
 *
 * Ark UI Menu の Svelte 5 Runes ラッパ。click trigger + dropdown 配置で
 * manual / ai / import 等の action menu 用途 (子 ② header `+` dropdown / 子 ④ `︙` overflow)。
 *
 * DESIGN.md §5 primitive、§10 z-index トークン (`--z-dropdown` = 20) 整合。
 *
 * #2260 Fix-1 (a11y BLOCK 解消): Ark UI の `ArkMenu.Trigger` は内部で `<button>` を render するため、
 * trigger snippet が `<button>` を含むと **nested button** になり focus / keyboard / disabled 動作が
 * 破綻する。これを防ぐため、本 primitive では **trigger snippet は inner content (icon / label) のみ**
 * を受け取り、`<button>` 要素自体は ArkMenu.Trigger が render する設計に統一する (Ark UI 推奨)。
 * 外部から付与したい class / testid / aria-label / data-tutorial / disabled は本 primitive の
 * props として ArkMenu.Trigger に pass-through する。
 *
 * trigger は 2 通り渡せる:
 *   1. `triggerLabel: string` で primitive 内部 button に label 文字列のみ描画
 *   2. `trigger: Snippet` で button の inner content をカスタム (icon span / multi-element OK)。
 *      ※ snippet 内で `<button>` を書かない (nested button 禁止、コンパイル時 lint 不可だが ADR-0004 規約)
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
	/** trigger snippet (button の inner content のみ。`<button>` 直書き禁止) */
	trigger?: Snippet;
	/** primitive 内部 button に描画する trigger label 文字列 (snippet 渡さない場合に使う) */
	triggerLabel?: string;
	/** primitive 内部 button に付与する追加 class (consumer 側の class をそのまま受ける) */
	triggerClass?: string;
	/** menu item 配列 */
	items: MenuItem[];
	/** menu placement (Ark UI positioning.placement) */
	placement?: Placement;
	/** menu Trigger button の aria-label (open ボタンの説明) */
	ariaLabel?: string;
	/** 任意の testid (Trigger button に付与) */
	testid?: string;
	/** Trigger button の disabled */
	disabled?: boolean;
	/** Trigger button の data-tutorial (チュートリアル anchor 用) */
	dataTutorial?: string;
}

let {
	trigger,
	triggerLabel,
	triggerClass = '',
	items,
	placement = 'bottom-end',
	ariaLabel,
	testid,
	disabled = false,
	dataTutorial,
}: Props = $props();
</script>

<ArkMenu.Root positioning={{ placement }}>
	<ArkMenu.Trigger
		class={trigger ? triggerClass : `menu-trigger-default ${triggerClass}`}
		aria-label={ariaLabel}
		data-testid={testid}
		data-tutorial={dataTutorial}
		disabled={disabled}
	>
		{#if trigger}
			{@render trigger()}
		{:else}
			{triggerLabel ?? ''}
		{/if}
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
	:global(.menu-trigger-default) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.4rem 0.85rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		background: var(--color-surface-card);
		font-size: 0.875rem;
		cursor: pointer;
	}

	:global(.menu-trigger-default:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.menu-positioner) {
		/* DESIGN section 10: --z-dropdown = 20 token (no raw z-index) */
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
