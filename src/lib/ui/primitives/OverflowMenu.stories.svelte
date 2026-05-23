<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { OVERFLOW_MENU_LABELS, STORYBOOK_LABELS } from '$lib/domain/labels';
import OverflowMenu from './OverflowMenu.svelte';

const L = STORYBOOK_LABELS.overflowMenu;
const items = OVERFLOW_MENU_LABELS.items;

const fullItems = [
	{
		id: items.marketplace.id,
		label: items.marketplace.label,
		icon: items.marketplace.icon,
		onSelect: () => {},
	},
	{
		id: items.aiSuggest.id,
		label: items.aiSuggest.label,
		icon: items.aiSuggest.icon,
		onSelect: () => {},
	},
	{ id: 'divider-1', divider: true },
	{
		id: items.restore.id,
		label: items.restore.label,
		icon: items.restore.icon,
		onSelect: () => {},
	},
	{ id: items.export.id, label: items.export.label, icon: items.export.icon, onSelect: () => {} },
	{ id: 'divider-2', divider: true },
	{ id: items.help.id, label: items.help.label, icon: items.help.icon, onSelect: () => {} },
];

const minimalItems = [
	{
		id: items.marketplace.id,
		label: items.marketplace.label,
		icon: items.marketplace.icon,
		onSelect: () => {},
	},
	{ id: items.help.id, label: items.help.label, icon: items.help.icon, onSelect: () => {} },
];

const disabledItems = [
	{
		id: items.marketplace.id,
		label: items.marketplace.label,
		icon: items.marketplace.icon,
		onSelect: () => {},
	},
	{
		id: items.aiSuggest.id,
		label: items.aiSuggest.label,
		icon: items.aiSuggest.icon,
		onSelect: () => {},
		disabled: true,
	},
	{ id: 'divider-1', divider: true },
	{ id: items.help.id, label: items.help.label, icon: items.help.icon, onSelect: () => {} },
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
