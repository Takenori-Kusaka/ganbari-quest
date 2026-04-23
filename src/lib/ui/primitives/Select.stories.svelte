<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { getThemeOptions } from '$lib/domain/labels';
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

<Story name="Default" args={{ label: '年', items: yearOptions, placeholder: '選択してください' }} />

<Story name="WithTheme" args={{ label: 'テーマカラー', items: themeItems, value: ['blue'] }} />

<Story name="WithError" args={{ label: '年', items: yearOptions, error: '選択してください', value: ['2025'] }} />

<Story name="Disabled" args={{ label: '年', items: yearOptions, disabled: true, value: ['2024'] }} />

<Story name="LongList" args={{ 
	label: 'アイテム', 
	items: Array.from({ length: 20 }, (_, i) => ({
		value: `item-${i}`,
		label: `アイテム ${i + 1}`,
	})),
	placeholder: 'アイテムを選択'
}} />

<style>
    :global(.sb-story) {
        max-width: 250px;
		/* Positionerがはみ出さないように */
		min-height: 250px;
    }
</style>
