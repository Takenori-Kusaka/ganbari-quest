<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
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
    <Button variant="primary" onclick={() => showToast(STORYBOOK_LABELS.toast.successTitle, STORYBOOK_LABELS.toast.successDesc, 'success')}>
      {STORYBOOK_LABELS.toast.successBtn}
    </Button>
    <Toast />
  </div>
</Story>

<Story name="Error" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="danger" onclick={() => showToast(STORYBOOK_LABELS.toast.errorTitle, STORYBOOK_LABELS.toast.errorDesc, 'error')}>
      {STORYBOOK_LABELS.toast.errorBtn}
    </Button>
    <Toast />
  </div>
</Story>

<Story name="Info" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="secondary" onclick={() => showToast(STORYBOOK_LABELS.toast.infoTitle, STORYBOOK_LABELS.toast.infoDesc, 'info')}>
      {STORYBOOK_LABELS.toast.infoBtn}
    </Button>
    <Toast />
  </div>
</Story>

<Story name="TitleOnly" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="ghost" onclick={() => showToast(STORYBOOK_LABELS.toast.titleOnlyTitle)}>
      {STORYBOOK_LABELS.toast.titleOnlyBtn}
    </Button>
    <Toast />
  </div>
</Story>