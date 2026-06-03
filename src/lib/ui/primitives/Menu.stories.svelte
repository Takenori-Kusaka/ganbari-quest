<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import Menu from './Menu.svelte';

const L = STORYBOOK_LABELS.menu;

// Default story の play で「trigger click → 項目 visible → 項目 select → onSelect 発火」を
// 検証するため fn() spy を注入した items を用意する (CX-DoR #8、操作回帰)。
const editSpy = fn();
const interactionItems = [
	{ id: 'edit', label: L.itemEdit, onSelect: editSpy },
	{ id: 'duplicate', label: L.itemDuplicate, onSelect: fn() },
	{ id: 'delete', label: L.itemDelete, onSelect: fn(), danger: true },
];

const basicItems = [
	{ id: 'edit', label: L.itemEdit, onSelect: () => {} },
	{ id: 'duplicate', label: L.itemDuplicate, onSelect: () => {} },
	{ id: 'delete', label: L.itemDelete, onSelect: () => {}, danger: true },
];

const iconItems = [
	{ id: 'edit', label: L.itemEdit, icon: L.itemEditIcon, onSelect: () => {} },
	{ id: 'duplicate', label: L.itemDuplicate, icon: L.itemDuplicateIcon, onSelect: () => {} },
	{ id: 'archive', label: L.itemArchive, icon: L.itemArchiveIcon, onSelect: () => {} },
	{ id: 'delete', label: L.itemDelete, icon: L.itemDeleteIcon, onSelect: () => {}, danger: true },
];

const disabledItems = [
	{ id: 'edit', label: L.itemEdit, icon: L.itemEditIcon, onSelect: () => {} },
	{
		id: 'disabled',
		label: L.itemDisabled,
		icon: L.itemArchiveIcon,
		onSelect: () => {},
		disabled: true,
	},
	{ id: 'delete', label: L.itemDelete, icon: L.itemDeleteIcon, onSelect: () => {}, danger: true },
];

const { Story } = defineMeta({
	title: 'Primitives/Menu',
	component: Menu,
	tags: ['autodocs'],
});
</script>

<!--
  Default: trigger click → menu open → item visible → item select → onSelect 発火。
  Menu は Portal 経由で content を render するため screen (document.body 起点) を使う。
-->
<Story
	name="Default"
	args={{ items: interactionItems, ariaLabel: L.ariaLabelOpen, triggerLabel: L.triggerButton }}
	play={async () => {
		// trigger button は aria-label (ariaLabelOpen) で accessible name を持つ。
		const trigger = screen.getByRole('button', { name: L.ariaLabelOpen });
		await expect(trigger).toBeVisible();
		// Ark UI Menu は full pointer sequence で開閉 / select するため userEvent を使う
		// (element.click() だけでは Ark の onSelect が発火しない)。
		await userEvent.click(trigger);
		// open 後、menu item (Portal) が visible になる
		const editItem = await waitFor(() => screen.getByTestId('menu-item-edit'));
		await expect(editItem).toBeVisible();
		// item select → onSelect spy 発火 (dead-end でない前提)
		await userEvent.click(editItem);
		await waitFor(() => expect(editSpy).toHaveBeenCalledTimes(1));
	}}
/>

<Story
	name="WithIcons"
	args={{ items: iconItems, ariaLabel: L.ariaLabelOpen, triggerLabel: L.triggerButton }}
/>

<!--
  WithDisabledItem: open 後、disabled item は aria-disabled=true で select 不可 (誤操作防止)。
-->
<Story
	name="WithDisabledItem"
	args={{ items: disabledItems, ariaLabel: L.ariaLabelOpen, triggerLabel: L.triggerButton }}
	play={async () => {
		const trigger = screen.getByRole('button', { name: L.ariaLabelOpen });
		await userEvent.click(trigger);
		const disabledItem = await waitFor(() => screen.getByTestId('menu-item-disabled'));
		// Ark UI Menu の disabled item は data-disabled 属性を付与する (select 不可の配線確認)
		await expect(disabledItem).toHaveAttribute('data-disabled');
	}}
/>

<Story
	name="PlacementBottomStart"
	args={{
		items: iconItems,
		ariaLabel: L.ariaLabelOpen,
		triggerLabel: L.triggerButton,
		placement: 'bottom-start',
	}}
/>

<Story
	name="PlacementTopEnd"
	args={{
		items: iconItems,
		ariaLabel: L.ariaLabelOpen,
		triggerLabel: L.triggerButton,
		placement: 'top-end',
	}}
/>

<style>
	:global(.sb-story) {
		min-height: 300px;
	}
</style>
