<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import IconButton from './IconButton.svelte';

const { Story } = defineMeta({
	title: 'Primitives/IconButton',
	component: IconButton,
	tags: ['autodocs'],
});
</script>

<Story name="Primary"><IconButton variant="primary" label={STORYBOOK_LABELS.iconButton.labelEdit}>✏️</IconButton></Story>
<Story name="Secondary"><IconButton variant="secondary" label={STORYBOOK_LABELS.iconButton.labelEdit}>✏️</IconButton></Story>
<Story name="Danger"><IconButton variant="danger" label={STORYBOOK_LABELS.iconButton.labelDelete}>🗑️</IconButton></Story>
<Story name="Ghost"><IconButton variant="ghost" label={STORYBOOK_LABELS.iconButton.labelClose}>✕</IconButton></Story>
<Story name="Outline"><IconButton variant="outline" label={STORYBOOK_LABELS.iconButton.labelEdit}>✏️</IconButton></Story>

<Story name="AllVariants">
  <div class="flex gap-2 items-center">
    <IconButton variant="primary" label={STORYBOOK_LABELS.iconButton.labelEdit}>✏️</IconButton>
    <IconButton variant="secondary" label={STORYBOOK_LABELS.iconButton.labelEdit}>✏️</IconButton>
    <IconButton variant="danger" label={STORYBOOK_LABELS.iconButton.labelDelete}>🗑️</IconButton>
    <IconButton variant="ghost" label={STORYBOOK_LABELS.iconButton.labelClose}>✕</IconButton>
    <IconButton variant="warning" label={STORYBOOK_LABELS.iconButton.labelWarning}>⚠️</IconButton>
    <IconButton variant="success" label={STORYBOOK_LABELS.iconButton.labelConfirm}>✓</IconButton>
    <IconButton variant="outline" label={STORYBOOK_LABELS.iconButton.labelEdit}>✏️</IconButton>
  </div>
</Story>

<Story name="AllSizes">
  <div class="flex gap-2 items-center">
    <IconButton variant="primary" label={STORYBOOK_LABELS.iconButton.labelSmall} size="sm">✏️</IconButton>
    <IconButton variant="primary" label={STORYBOOK_LABELS.iconButton.labelMedium} size="md">✏️</IconButton>
    <IconButton variant="primary" label={STORYBOOK_LABELS.iconButton.labelLarge} size="lg">✏️</IconButton>
  </div>
</Story>
