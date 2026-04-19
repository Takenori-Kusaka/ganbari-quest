<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import Button from './Button.svelte';
import Toast, { showToast } from './Toast.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Toast',
	component: Toast,
	tags: ['autodocs'],
});
</script>

<Story name="Success" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="primary" onclick={() => showToast('保存しました！', 'プランを変更しました', 'success')}>
      Success toast を表示
    </Button>
    <Toast />
  </div>
</Story>

<Story name="Error" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="danger" onclick={() => showToast('エラー', '通信に失敗しました', 'error')}>
      Error toast を表示
    </Button>
    <Toast />
  </div>
</Story>

<Story name="Info" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="secondary" onclick={() => showToast('お知らせ', '新機能が追加されました', 'info')}>
      Info toast を表示
    </Button>
    <Toast />
  </div>
</Story>

<Story name="TitleOnly" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="ghost" onclick={() => showToast('コピーしました')}>
      タイトルのみ toast
    </Button>
    <Toast />
  </div>
</Story>
