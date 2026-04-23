<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import BirthdayInput from './BirthdayInput.svelte';

const { Story } = defineMeta({
	title: 'Primitives/BirthdayInput',
	component: BirthdayInput,
	tags: ['autodocs'],
	argTypes: {
		label: { control: 'text' },
		value: { control: 'text' },
		name: { control: 'text' },
		id: { control: 'text' },
		required: { control: 'boolean' },
		error: { control: 'text' },
	},
});
</script>

<Story
	name="Default"
	args={{
		label: 'おたんじょうび',
	}}
/>

<Story
	name="WithValue"
	args={{
		label: 'おたんじょうび',
		value: '2018-12-25',
	}}
/>

<Story
	name="LeapYear"
	args={{
		label: 'おたんじょうび',
		value: '2024-02-29',
	}}
/>

<Story
	name="WithError"
	args={{
		label: 'おたんじょうび',
		value: '2024-02-30', // Invalid date
		error: '有効な日付を入力してください。',
        required: true,
	}}
/>

<style>
    :global(.sb-story) {
        max-width: 400px;
    }
</style>
