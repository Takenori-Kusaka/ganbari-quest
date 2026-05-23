<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import VisibilityChipGroup from './VisibilityChipGroup.svelte';

const L = STORYBOOK_LABELS.visibilityChipGroup;

const threeChildren = [
	{ id: 1, nickname: L.childTaro.split(' ')[0], age: 8, icon: '👦' },
	{ id: 2, nickname: L.childHina.split(' ')[0], age: 5, icon: '👧' },
	{ id: 3, nickname: L.childKenta.split(' ')[0], age: 1, icon: '👶' },
];

const allVisible = { 1: true, 2: true, 3: true };
const mixedVisibility = { 1: true, 2: true, 3: false };
const allHidden = { 1: false, 2: false, 3: false };

const { Story } = defineMeta({
	title: 'Primitives/VisibilityChipGroup',
	component: VisibilityChipGroup,
	tags: ['autodocs'],
});
</script>

<Story
	name="Default"
	args={{
		children: threeChildren,
		visibility: allVisible,
		onToggle: () => {},
	}}
/>

<Story
	name="MixedVisibility"
	args={{
		children: threeChildren,
		visibility: mixedVisibility,
		onToggle: () => {},
	}}
/>

<Story
	name="AllHidden"
	args={{
		children: threeChildren,
		visibility: allHidden,
		onToggle: () => {},
	}}
/>

<Story
	name="WithoutShortcuts"
	args={{
		children: threeChildren,
		visibility: mixedVisibility,
		onToggle: () => {},
		showShortcuts: false,
	}}
/>

<Story
	name="SingleChild"
	args={{
		children: [threeChildren[0]],
		visibility: { 1: true },
		onToggle: () => {},
	}}
/>

<style>
	:global(.sb-story) {
		min-height: 200px;
	}
</style>
