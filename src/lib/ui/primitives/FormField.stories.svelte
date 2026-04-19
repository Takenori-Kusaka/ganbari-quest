<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
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

<Story name="Text" args={{ label: 'ニックネーム', placeholder: 'たろうくん' }} />
<Story name="Email" args={{ label: 'メールアドレス', type: 'email', placeholder: 'user@example.com' }} />
<Story name="Password" args={{ label: 'パスワード', type: 'password' }} />
<Story name="PasswordWithToggle" args={{ label: 'パスワード', type: 'password', showToggle: true }} />
<Story name="Number" args={{ label: '年齢', type: 'number', min: 0, max: 18 }} />
<Story name="Tel" args={{ label: '電話番号', type: 'tel', placeholder: '090-1234-5678' }} />
<Story name="Date" args={{ label: '生年月日', type: 'date' }} />
<Story name="Time" args={{ label: 'リマインダー時刻', type: 'time' }} />
<Story name="Textarea" args={{ label: 'メモ', type: 'textarea', rows: 4, placeholder: '自由記入...' }} />
<Story name="TextareaLarge" args={{ label: '長文メモ', type: 'textarea', rows: 8, placeholder: '8 行...' }} />

<Story name="WithError" args={{ label: '名前', error: '入力が必要です', value: '' }} />
<Story name="WithHint" args={{ label: '表示名', hint: '3〜20文字で入力してください' }} />
<Story name="TextareaWithError" args={{ label: 'メモ', type: 'textarea', rows: 3, error: '500 文字以内で入力してください', value: '' }} />
<Story name="Disabled" args={{ label: '無効なフィールド', disabled: true, value: '編集不可' }} />
<Story name="TextareaDisabled" args={{ label: '無効メモ', type: 'textarea', disabled: true, value: '編集不可のテキスト' }} />
