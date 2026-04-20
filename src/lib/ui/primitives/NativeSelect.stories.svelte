<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import NativeSelect from './NativeSelect.svelte';

const themeOptions = [
	{ value: 'forest', label: 'もりのテーマ' },
	{ value: 'ocean', label: 'うみのテーマ' },
	{ value: 'space', label: 'うちゅうのテーマ' },
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

<Story name="Default" args={{ label: 'テーマ', options: themeOptions }} />
<Story name="WithPlaceholder" args={{ label: '年', options: yearOptions, placeholder: '選択してください' }} />
<Story name="WithValue" args={{ label: 'テーマ', options: themeOptions, value: 'ocean' }} />
<Story name="WithError" args={{ label: 'テーマ', options: themeOptions, error: '選択してください' }} />
<Story name="WithHint" args={{ label: 'テーマ', options: themeOptions, hint: '後で変更できます' }} />
<Story name="Disabled" args={{ label: 'テーマ', options: themeOptions, disabled: true, value: 'forest' }} />
<Story name="WithDisabledOption" args={{
	label: 'プラン',
	options: [
		{ value: 'free', label: 'フリープラン' },
		{ value: 'standard', label: 'スタンダードプラン' },
		{ value: 'family', label: 'ファミリープラン (準備中)', disabled: true },
	],
}} />
