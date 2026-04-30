<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import FormField from './FormField.svelte';

const { Story } = defineMeta({
	title: 'Primitives/FormField',
	component: FormField,
	tags: ['autodocs'],
	argTypes: {
		type: {
			control: 'select',
			options: [
				'text',
				'email',
				'password',
				'number',
				'tel',
				'url',
				'search',
				'date',
				'time',
				'datetime-local',
				'textarea',
			],
		},
		label: { control: 'text' },
		error: { control: 'text' },
		hint: { control: 'text' },
		placeholder: { control: 'text' },
		required: { control: 'boolean' },
		disabled: { control: 'boolean' },
		rows: { control: 'number' },
	},
});
</script>

<Story name="Text" args={{ label: STORYBOOK_LABELS.formField.labelNickname, placeholder: STORYBOOK_LABELS.formField.placeholderNickname }} />
<Story name="Email" args={{ label: STORYBOOK_LABELS.formField.labelEmail, type: 'email', placeholder: STORYBOOK_LABELS.formField.placeholderEmail }} />
<Story name="Password" args={{ label: STORYBOOK_LABELS.formField.labelPassword, type: 'password' }} />
<Story name="PasswordWithToggle" args={{ label: STORYBOOK_LABELS.formField.labelPassword, type: 'password', showToggle: true }} />
<Story name="Number" args={{ label: STORYBOOK_LABELS.formField.labelAge, type: 'number', min: 0, max: 18 }} />
<Story name="Tel" args={{ label: STORYBOOK_LABELS.formField.labelTel, type: 'tel', placeholder: STORYBOOK_LABELS.formField.placeholderTel }} />
<Story name="Date" args={{ label: STORYBOOK_LABELS.formField.labelBirthday, type: 'date' }} />
<Story name="Time" args={{ label: STORYBOOK_LABELS.formField.labelReminderTime, type: 'time' }} />
<Story name="Textarea" args={{ label: STORYBOOK_LABELS.formField.labelMemo, type: 'textarea', rows: 4, placeholder: STORYBOOK_LABELS.formField.placeholderMemo }} />
<Story name="TextareaLarge" args={{ label: STORYBOOK_LABELS.formField.labelMemoLong, type: 'textarea', rows: 8, placeholder: STORYBOOK_LABELS.formField.placeholderMemoLong }} />

<Story name="WithError" args={{ label: STORYBOOK_LABELS.formField.labelName, error: STORYBOOK_LABELS.formField.errorRequired, value: '' }} />
<Story name="WithHint" args={{ label: STORYBOOK_LABELS.formField.labelDisplayName, hint: STORYBOOK_LABELS.formField.hintDisplayName }} />
<Story name="TextareaWithError" args={{ label: STORYBOOK_LABELS.formField.labelMemo, type: 'textarea', rows: 3, error: STORYBOOK_LABELS.formField.errorMemoMax, value: '' }} />
<Story name="Disabled" args={{ label: STORYBOOK_LABELS.formField.labelDisabled, disabled: true, value: STORYBOOK_LABELS.formField.valueDisabled }} />
<Story name="TextareaDisabled" args={{ label: STORYBOOK_LABELS.formField.labelDisabledMemo, type: 'textarea', disabled: true, value: STORYBOOK_LABELS.formField.valueDisabledMemo }} />
