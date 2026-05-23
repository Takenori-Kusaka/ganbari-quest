<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { OVERFLOW_MENU_LABELS, STORYBOOK_LABELS } from '$lib/domain/labels';
import OverflowMenu from './OverflowMenu.svelte';

const L = STORYBOOK_LABELS.overflowMenu;
const items = OVERFLOW_MENU_LABELS.items;

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

<Story name="Default" args={{ items: fullItems, ariaLabel: L.ariaLabelOpen }} />

<Story name="Minimal" args={{ items: minimalItems, ariaLabel: L.ariaLabelOpen }} />

<Story name="WithDisabledItem" args={{ items: disabledItems, ariaLabel: L.ariaLabelOpen }} />

<Story name="PlacementBottomStart" args={{ items: fullItems, ariaLabel: L.ariaLabelOpen, placement: 'bottom-start' }} />

<Story name="Disabled" args={{ items: fullItems, ariaLabel: L.ariaLabelOpen, disabled: true }} />

<style>
	:global(.sb-story) {
		min-height: 350px;
	}
</style>
