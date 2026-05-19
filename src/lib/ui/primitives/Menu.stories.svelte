<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import Menu from './Menu.svelte';

const L = STORYBOOK_LABELS.menu;

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

<Story
	name="Default"
	args={{ items: basicItems, ariaLabel: L.ariaLabelOpen, triggerLabel: L.triggerButton }}
/>

<Story
	name="WithIcons"
	args={{ items: iconItems, ariaLabel: L.ariaLabelOpen, triggerLabel: L.triggerButton }}
/>

<Story
	name="WithDisabledItem"
	args={{ items: disabledItems, ariaLabel: L.ariaLabelOpen, triggerLabel: L.triggerButton }}
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
