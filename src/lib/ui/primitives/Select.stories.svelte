<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { getThemeOptions, STORYBOOK_LABELS } from '$lib/domain/labels';
import Select from './Select.svelte';

const themeItems = getThemeOptions().map((opt) => ({
	value: opt.value,
	label: `${opt.emoji} ${opt.label}`,
}));

const yearOptions = [
	{ value: '2024', label: '2024年' },
	{ value: '2025', label: '2025年' },
	{ value: '2026', label: '2026年' },
];

const { Story } = defineMeta({
	title: 'Primitives/Select',
	component: Select,
	tags: ['autodocs'],
	argTypes: {
		label: { control: 'text' },
		placeholder: { control: 'text' },
		error: { control: 'text' },
		disabled: { control: 'boolean' },
	},
});
</script>

<Story name="Default" args={{ label: STORYBOOK_LABELS.select.labelYear, items: yearOptions, placeholder: STORYBOOK_LABELS.select.placeholder }} />

<Story name="WithTheme" args={{ label: STORYBOOK_LABELS.select.labelTheme, items: themeItems, value: ['blue'] }} />

<Story name="WithError" args={{ label: STORYBOOK_LABELS.select.labelYear, items: yearOptions, error: STORYBOOK_LABELS.select.errorRequired, value: ['2025'] }} />

<Story name="Disabled" args={{ label: STORYBOOK_LABELS.select.labelYear, items: yearOptions, disabled: true, value: ['2024'] }} />

<Story name="LongList" args={{
	label: STORYBOOK_LABELS.select.labelItem,
	items: Array.from({ length: 20 }, (_, i) => ({
		value: `item-${i}`,
		label: `${STORYBOOK_LABELS.select.itemPrefix} ${i + 1}`,
	})),
	placeholder: STORYBOOK_LABELS.select.placeholderItem
}} />

<style>
    :global(.sb-story) {
        max-width: 250px;
		/* Prevent positioner overflow */
		min-height: 250px;
    }
</style>
