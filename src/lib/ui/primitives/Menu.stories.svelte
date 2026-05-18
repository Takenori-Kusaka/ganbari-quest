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

<Story name="Default">
	<Menu items={basicItems} ariaLabel={L.ariaLabelOpen}>
		{#snippet trigger()}
			<button type="button" class="story-trigger">{L.triggerButton}</button>
		{/snippet}
	</Menu>
</Story>

<Story name="WithIcons">
	<Menu items={iconItems} ariaLabel={L.ariaLabelOpen}>
		{#snippet trigger()}
			<button type="button" class="story-trigger">{L.triggerButton}</button>
		{/snippet}
	</Menu>
</Story>

<Story name="WithDisabledItem">
	<Menu items={disabledItems} ariaLabel={L.ariaLabelOpen}>
		{#snippet trigger()}
			<button type="button" class="story-trigger">{L.triggerButton}</button>
		{/snippet}
	</Menu>
</Story>

<Story name="PlacementBottomStart">
	<Menu items={iconItems} placement="bottom-start" ariaLabel={L.ariaLabelOpen}>
		{#snippet trigger()}
			<button type="button" class="story-trigger">{L.triggerButton}</button>
		{/snippet}
	</Menu>
</Story>

<Story name="PlacementTopEnd">
	<Menu items={iconItems} placement="top-end" ariaLabel={L.ariaLabelOpen}>
		{#snippet trigger()}
			<button type="button" class="story-trigger">{L.triggerButton}</button>
		{/snippet}
	</Menu>
</Story>

<style>
	:global(.story-trigger) {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		background: var(--color-surface-card);
		font-size: 0.875rem;
		cursor: pointer;
	}
	:global(.sb-story) {
		min-height: 300px;
	}
</style>
