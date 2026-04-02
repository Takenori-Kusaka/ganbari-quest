<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import Alert from './Alert.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Alert',
	component: Alert,
	tags: ['autodocs'],
	argTypes: {
		variant: {
			control: 'select',
			options: ['success', 'warning', 'danger', 'info'],
		},
		message: { control: 'text' },
	},
});
</script>

<Story name="Success" args={{ variant: 'success', message: '保存しました！' }} />
<Story name="Warning" args={{ variant: 'warning', message: '入力内容を確認してください' }} />
<Story name="Danger" args={{ variant: 'danger', message: 'エラーが発生しました' }} />
<Story name="Info" args={{ variant: 'info', message: 'お知らせがあります' }} />

<Story name="AllVariants">
  {#snippet children()}
    <div class="flex flex-col gap-2">
      <Alert variant="success" message="保存しました！" />
      <Alert variant="warning" message="入力内容を確認してください" />
      <Alert variant="danger" message="エラーが発生しました" />
      <Alert variant="info" message="お知らせがあります" />
    </div>
  {/snippet}
</Story>
