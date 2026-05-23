<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import ChildSelectionDialog from './ChildSelectionDialog.svelte';

const L = STORYBOOK_LABELS.childSelectionDialog;

const threeChildren = [
	{ id: 1, nickname: L.childTaro.split(' ')[0], age: 8, icon: L.childTaroIcon },
	{ id: 2, nickname: L.childHina.split(' ')[0], age: 5, icon: L.childHinaIcon },
	{ id: 3, nickname: L.childKenta.split(' ')[0], age: 1, icon: L.childKentaIcon },
];

const oneChild = [{ id: 1, nickname: L.childTaro.split(' ')[0], age: 8, icon: L.childTaroIcon }];

/** @type {Array<{id: number; nickname: string; age?: number; icon?: string}>} */
const noChildren = [];

const { Story } = defineMeta({
	title: 'Primitives/ChildSelectionDialog',
	component: ChildSelectionDialog,
	tags: ['autodocs'],
});
</script>

<Story
	name="Default"
	args={{
		children: threeChildren,
		open: true,
		allowMultiple: false,
		onConfirm: () => {},
		onCancel: () => {},
	}}
/>

<Story
	name="AllowMultiple"
	args={{
		children: threeChildren,
		open: true,
		allowMultiple: true,
		onConfirm: () => {},
		onCancel: () => {},
	}}
/>

<Story
	name="SingleChild"
	args={{
		children: oneChild,
		open: true,
		allowMultiple: false,
		onConfirm: () => {},
		onCancel: () => {},
	}}
/>

<Story
	name="Empty"
	args={{
		children: noChildren,
		open: true,
		allowMultiple: false,
		onConfirm: () => {},
		onCancel: () => {},
	}}
/>

<style>
	:global(.sb-story) {
		min-height: 500px;
	}
</style>
