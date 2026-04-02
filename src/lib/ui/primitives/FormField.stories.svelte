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
			options: ['text', 'email', 'password', 'number', 'tel', 'url', 'search'],
		},
		label: { control: 'text' },
		error: { control: 'text' },
		hint: { control: 'text' },
		placeholder: { control: 'text' },
		required: { control: 'boolean' },
		disabled: { control: 'boolean' },
	},
});
</script>

<Story name="Text" args={{ label: 'ニックネーム', placeholder: 'ゆうきちゃん' }} />
<Story name="Email" args={{ label: 'メールアドレス', type: 'email', placeholder: 'user@example.com' }} />
<Story name="Password" args={{ label: 'パスワード', type: 'password' }} />
<Story name="Number" args={{ label: '年齢', type: 'number', min: 0, max: 18 }} />

<Story name="WithError" args={{ label: '名前', error: '入力が必要です', value: '' }} />
<Story name="WithHint" args={{ label: '表示名', hint: '3〜20文字で入力してください' }} />
<Story name="Disabled" args={{ label: '無効なフィールド', disabled: true, value: '編集不可' }} />
