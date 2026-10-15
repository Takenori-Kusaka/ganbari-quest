<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { STORYBOOK_LABELS, UI_PRIMITIVES_LABELS } from '$lib/domain/labels';
import Alert from './Alert.svelte';

/**
 * #4572: 各 variant の重大度が、視覚的に隠れたラベルとして本文の先頭に在ること (スクリーンリーダー向け)。
 * danger だけ role=alert、他は role=status。絵文字アイコンは aria-hidden のまま読み上げ対象外。
 *
 * @param {'success' | 'warning' | 'danger' | 'info'} variant
 * @param {'alert' | 'status'} role
 * @param {string} message
 */
const severityPlay =
	(variant, role, message) =>
	/** @param {{ canvasElement: HTMLElement }} context */
	async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const region = canvas.getByRole(role);
		await expect(region).toHaveTextContent(UI_PRIMITIVES_LABELS.alertSeverity[variant]);
		await expect(region).toHaveTextContent(message);
		const label = within(region).getByText(UI_PRIMITIVES_LABELS.alertSeverity[variant]);
		await expect(label).toHaveClass('sr-only');
		await expect(region.querySelector('[aria-hidden="true"]')).not.toBeNull();
	};

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

<Story
	name="Success"
	args={{ variant: 'success', message: STORYBOOK_LABELS.alert.successMessage }}
	play={severityPlay('success', 'status', STORYBOOK_LABELS.alert.successMessage)}
/>
<Story
	name="Warning"
	args={{ variant: 'warning', message: STORYBOOK_LABELS.alert.warningMessage }}
	play={severityPlay('warning', 'status', STORYBOOK_LABELS.alert.warningMessage)}
/>
<Story
	name="Danger"
	args={{ variant: 'danger', message: STORYBOOK_LABELS.alert.dangerMessage }}
	play={severityPlay('danger', 'alert', STORYBOOK_LABELS.alert.dangerMessage)}
/>
<Story
	name="Info"
	args={{ variant: 'info', message: STORYBOOK_LABELS.alert.infoMessage }}
	play={severityPlay('info', 'status', STORYBOOK_LABELS.alert.infoMessage)}
/>

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
