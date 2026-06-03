<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, userEvent, within } from 'storybook/test';
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

<!--
  Text: input にタイプ → value が反映される (双方向 binding 健全性、CX-DoR #8)。
  FormField は canvasElement 内に render されるため within(canvasElement) で query する。
-->
<Story
	name="Text"
	args={{ label: STORYBOOK_LABELS.formField.labelNickname, placeholder: STORYBOOK_LABELS.formField.placeholderNickname }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// label 経由で input を取得 (FormField は label / input を for/id で関連付け)
		const input = canvas.getByLabelText(STORYBOOK_LABELS.formField.labelNickname);
		await expect(input).toBeEnabled();
		await userEvent.type(input, STORYBOOK_LABELS.childSelectionDialog.childTaro);
		await expect(input).toHaveValue(STORYBOOK_LABELS.childSelectionDialog.childTaro);
	}}
/>
<Story name="Email" args={{ label: STORYBOOK_LABELS.formField.labelEmail, type: 'email', placeholder: STORYBOOK_LABELS.formField.placeholderEmail }} />
<Story name="Password" args={{ label: STORYBOOK_LABELS.formField.labelPassword, type: 'password' }} />
<Story name="PasswordWithToggle" args={{ label: STORYBOOK_LABELS.formField.labelPassword, type: 'password', showToggle: true }} />
<Story name="Number" args={{ label: STORYBOOK_LABELS.formField.labelAge, type: 'number', min: 0, max: 18 }} />
<Story name="Tel" args={{ label: STORYBOOK_LABELS.formField.labelTel, type: 'tel', placeholder: STORYBOOK_LABELS.formField.placeholderTel }} />
<Story name="Date" args={{ label: STORYBOOK_LABELS.formField.labelBirthday, type: 'date' }} />
<Story name="Time" args={{ label: STORYBOOK_LABELS.formField.labelReminderTime, type: 'time' }} />
<Story name="Textarea" args={{ label: STORYBOOK_LABELS.formField.labelMemo, type: 'textarea', rows: 4, placeholder: STORYBOOK_LABELS.formField.placeholderMemo }} />
<Story name="TextareaLarge" args={{ label: STORYBOOK_LABELS.formField.labelMemoLong, type: 'textarea', rows: 8, placeholder: STORYBOOK_LABELS.formField.placeholderMemoLong }} />

<!--
  WithError: error 文言が role=alert で表示され、input が aria-invalid=true になる
  (エラー状態の a11y / 配線健全性、CX-DoR #8)。
-->
<Story
	name="WithError"
	args={{ label: STORYBOOK_LABELS.formField.labelName, error: STORYBOOK_LABELS.formField.errorRequired, value: '' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// error message は role=alert で render される
		const errorMsg = canvas.getByRole('alert');
		await expect(errorMsg).toHaveTextContent(STORYBOOK_LABELS.formField.errorRequired);
		// input は aria-invalid=true (スクリーンリーダー / バリデーション連動)
		const input = canvas.getByLabelText(STORYBOOK_LABELS.formField.labelName);
		await expect(input).toHaveAttribute('aria-invalid', 'true');
	}}
/>
<Story name="WithHint" args={{ label: STORYBOOK_LABELS.formField.labelDisplayName, hint: STORYBOOK_LABELS.formField.hintDisplayName }} />
<Story name="TextareaWithError" args={{ label: STORYBOOK_LABELS.formField.labelMemo, type: 'textarea', rows: 3, error: STORYBOOK_LABELS.formField.errorMemoMax, value: '' }} />
<!--
  Disabled: disabled prop で input が編集不可になる (誤入力防止の配線確認、CX-DoR #8)。
-->
<Story
	name="Disabled"
	args={{ label: STORYBOOK_LABELS.formField.labelDisabled, disabled: true, value: STORYBOOK_LABELS.formField.valueDisabled }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByLabelText(STORYBOOK_LABELS.formField.labelDisabled);
		await expect(input).toBeDisabled();
	}}
/>
<Story name="TextareaDisabled" args={{ label: STORYBOOK_LABELS.formField.labelDisabledMemo, type: 'textarea', disabled: true, value: STORYBOOK_LABELS.formField.valueDisabledMemo }} />
