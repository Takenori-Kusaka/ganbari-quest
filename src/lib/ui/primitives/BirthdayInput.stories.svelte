<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
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
		label: STORYBOOK_LABELS.birthdayInput.labelDefault,
	}}
/>

<Story
	name="WithValue"
	args={{
		label: STORYBOOK_LABELS.birthdayInput.labelDefault,
		value: '2018-12-25',
	}}
/>

<Story
	name="LeapYear"
	args={{
		label: STORYBOOK_LABELS.birthdayInput.labelDefault,
		value: '2024-02-29',
	}}
/>

<Story
	name="WithError"
	args={{
		label: STORYBOOK_LABELS.birthdayInput.labelDefault,
		value: '2024-02-30',
		error: STORYBOOK_LABELS.birthdayInput.errorInvalid,
        required: true,
	}}
/>

<style>
    :global(.sb-story) {
        max-width: 400px;
    }
</style>
