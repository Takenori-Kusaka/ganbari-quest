<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import Button from './Button.svelte';
import Toast, { showToast } from './Toast.svelte';

const L = STORYBOOK_LABELS.toast;

const { Story } = defineMeta({
	title: 'Primitives/Toast',
	component: Toast,
	tags: ['autodocs'],
});
</script>

<Story name="Success" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="primary" onclick={() => showToast(L.successTitle, L.successDesc, 'success')}>
      Success toast
    </Button>
    <Toast />
  </div>
</Story>

<Story name="Error" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="danger" onclick={() => showToast(L.errorTitle, L.errorDesc, 'error')}>
      Error toast
    </Button>
    <Toast />
  </div>
</Story>

<Story name="Info" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="secondary" onclick={() => showToast(L.infoTitle, L.infoDesc, 'info')}>
      Info toast
    </Button>
    <Toast />
  </div>
</Story>

<Story name="TitleOnly" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="ghost" onclick={() => showToast(L.copyTitle)}>
      Title only toast
    </Button>
    <Toast />
  </div>
</Story>
