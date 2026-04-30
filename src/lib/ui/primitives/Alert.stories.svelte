<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
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

<Story name="Success" args={{ variant: 'success', message: STORYBOOK_LABELS.alert.successMessage }} />
<Story name="Warning" args={{ variant: 'warning', message: STORYBOOK_LABELS.alert.warningMessage }} />
<Story name="Danger" args={{ variant: 'danger', message: STORYBOOK_LABELS.alert.dangerMessage }} />
<Story name="Info" args={{ variant: 'info', message: STORYBOOK_LABELS.alert.infoMessage }} />

<Story name="AllVariants">
  {#snippet children()}
    <div class="flex flex-col gap-2">
      <Alert variant="success" message={STORYBOOK_LABELS.alert.successMessage} />
      <Alert variant="warning" message={STORYBOOK_LABELS.alert.warningMessage} />
      <Alert variant="danger" message={STORYBOOK_LABELS.alert.dangerMessage} />
      <Alert variant="info" message={STORYBOOK_LABELS.alert.infoMessage} />
    </div>
  {/snippet}
</Story>
