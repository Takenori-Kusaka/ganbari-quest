<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { OVERFLOW_MENU_LABELS, STORYBOOK_LABELS } from '$lib/domain/labels';
import OverflowMenu from './OverflowMenu.svelte';

const L = STORYBOOK_LABELS.overflowMenu;
const items = OVERFLOW_MENU_LABELS.items;

// Default story の play で「⋮ trigger click → 項目 visible → marketplace 項目 select →
// onSelect 発火」を検証するため fn() spy を注入した items を用意する (CX-DoR #8)。
const marketplaceSpy = fn();
/** @type {import('./OverflowMenu.svelte').OverflowMenuItem[]} */
const interactionItems = [
	{
		type: 'action',
		id: items.marketplace.id,
		label: items.marketplace.label,
		icon: items.marketplace.icon,
		onSelect: marketplaceSpy,
	},
	{ type: 'divider', id: 'divider-1' },
	{
		type: 'action',
		id: items.help.id,
		label: items.help.label,
		icon: items.help.icon,
		onSelect: fn(),
	},
];

/** @type {import('./OverflowMenu.svelte').OverflowMenuItem[]} */
const fullItems = [
	{
		type: 'action',
		id: items.marketplace.id,
		label: items.marketplace.label,
		icon: items.marketplace.icon,
		onSelect: () => {},
	},
	{
		type: 'action',
		id: items.aiSuggest.id,
		label: items.aiSuggest.label,
		icon: items.aiSuggest.icon,
		onSelect: () => {},
	},
	{ type: 'divider', id: 'divider-1' },
	{
		type: 'action',
		id: items.restore.id,
		label: items.restore.label,
		icon: items.restore.icon,
		onSelect: () => {},
	},
	{
		type: 'action',
		id: items.export.id,
		label: items.export.label,
		icon: items.export.icon,
		onSelect: () => {},
	},
	{ type: 'divider', id: 'divider-2' },
	{
		type: 'action',
		id: items.help.id,
		label: items.help.label,
		icon: items.help.icon,
		onSelect: () => {},
	},
];

/** @type {import('./OverflowMenu.svelte').OverflowMenuItem[]} */
const minimalItems = [
	{
		type: 'action',
		id: items.marketplace.id,
		label: items.marketplace.label,
		icon: items.marketplace.icon,
		onSelect: () => {},
	},
	{
		type: 'action',
		id: items.help.id,
		label: items.help.label,
		icon: items.help.icon,
		onSelect: () => {},
	},
];

/** @type {import('./OverflowMenu.svelte').OverflowMenuItem[]} */
const disabledItems = [
	{
		type: 'action',
		id: items.marketplace.id,
		label: items.marketplace.label,
		icon: items.marketplace.icon,
		onSelect: () => {},
	},
	{
		type: 'action',
		id: items.aiSuggest.id,
		label: items.aiSuggest.label,
		icon: items.aiSuggest.icon,
		onSelect: () => {},
		disabled: true,
	},
	{ type: 'divider', id: 'divider-1' },
	{
		type: 'action',
		id: items.help.id,
		label: items.help.label,
		icon: items.help.icon,
		onSelect: () => {},
	},
];

const { Story } = defineMeta({
	title: 'Primitives/OverflowMenu',
	component: OverflowMenu,
	tags: ['autodocs'],
});
</script>

<!--
  Default: ⋮ trigger click → menu open → marketplace 項目 visible → select → onSelect 発火。
  OverflowMenu は Portal 経由で content を render するため screen (document.body 起点) を使う。
-->
<Story
	name="Default"
	args={{ items: interactionItems, ariaLabel: L.ariaLabelOpen }}
	play={async () => {
		// ⋮ trigger button は aria-label (ariaLabelOpen) で accessible name を持つ。
		const trigger = screen.getByRole('button', { name: L.ariaLabelOpen });
		await expect(trigger).toBeVisible();
		// Ark UI Menu は full pointer sequence で開閉 / select するため userEvent を使う
		// (element.click() だけでは Ark の onSelect が発火しない)。
		await userEvent.click(trigger);
		// open 後、marketplace 項目 (Portal) が visible → select で onSelect 発火
		const marketplaceItem = await waitFor(() =>
			screen.getByTestId(`overflow-menu-item-${items.marketplace.id}`),
		);
		await expect(marketplaceItem).toBeVisible();
		await userEvent.click(marketplaceItem);
		await waitFor(() => expect(marketplaceSpy).toHaveBeenCalledTimes(1));
	}}
/>

<Story name="Minimal" args={{ items: minimalItems, ariaLabel: L.ariaLabelOpen }} />

<Story name="WithDisabledItem" args={{ items: disabledItems, ariaLabel: L.ariaLabelOpen }} />

<Story name="PlacementBottomStart" args={{ items: fullItems, ariaLabel: L.ariaLabelOpen, placement: 'bottom-start' }} />

<Story name="Disabled" args={{ items: fullItems, ariaLabel: L.ariaLabelOpen, disabled: true }} />

<style>
	:global(.sb-story) {
		min-height: 350px;
	}
</style>
