<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import NativeSelect from './NativeSelect.svelte';

const themeOptions = [
	{ value: 'forest', label: STORYBOOK_LABELS.nativeSelect.optionThemeForest },
	{ value: 'ocean', label: STORYBOOK_LABELS.nativeSelect.optionThemeOcean },
	{ value: 'space', label: STORYBOOK_LABELS.nativeSelect.optionThemeSpace },
];

const yearOptions = [
	{ value: '2024', label: '2024年' },
	{ value: '2025', label: '2025年' },
	{ value: '2026', label: '2026年' },
];

const { Story } = defineMeta({
	title: 'Primitives/NativeSelect',
	component: NativeSelect,
	tags: ['autodocs'],
	argTypes: {
		label: { control: 'text' },
		error: { control: 'text' },
		hint: { control: 'text' },
		placeholder: { control: 'text' },
		required: { control: 'boolean' },
		disabled: { control: 'boolean' },
	},
});
</script>

<Story name="Default" args={{ label: STORYBOOK_LABELS.nativeSelect.labelTheme, options: themeOptions }} />
<Story name="WithPlaceholder" args={{ label: STORYBOOK_LABELS.nativeSelect.labelYear, options: yearOptions, placeholder: STORYBOOK_LABELS.nativeSelect.placeholder }} />
<Story name="WithValue" args={{ label: STORYBOOK_LABELS.nativeSelect.labelTheme, options: themeOptions, value: 'ocean' }} />
<Story name="WithError" args={{ label: STORYBOOK_LABELS.nativeSelect.labelTheme, options: themeOptions, error: STORYBOOK_LABELS.nativeSelect.errorRequired }} />
<Story name="WithHint" args={{ label: STORYBOOK_LABELS.nativeSelect.labelTheme, options: themeOptions, hint: STORYBOOK_LABELS.nativeSelect.hintLater }} />
<Story name="Disabled" args={{ label: STORYBOOK_LABELS.nativeSelect.labelTheme, options: themeOptions, disabled: true, value: 'forest' }} />
<Story name="WithDisabledOption" args={{
	label: STORYBOOK_LABELS.nativeSelect.labelPlan,
	options: [
		{ value: 'free', label: STORYBOOK_LABELS.nativeSelect.optionPlanFree },
		{ value: 'standard', label: STORYBOOK_LABELS.nativeSelect.optionPlanStandard },
		{ value: 'family', label: STORYBOOK_LABELS.nativeSelect.optionPlanFamily, disabled: true },
	],
}} />
