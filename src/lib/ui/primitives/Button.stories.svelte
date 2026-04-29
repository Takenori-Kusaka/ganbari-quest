<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import Button from './Button.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Button',
	component: Button,
	tags: ['autodocs'],
});
</script>

<Story name="Primary">
  <Button variant="primary">{STORYBOOK_LABELS.button.primary}</Button>
</Story>

<Story name="Secondary">
  <Button variant="secondary">{STORYBOOK_LABELS.button.secondary}</Button>
</Story>

<Story name="Danger">
  <Button variant="danger">{STORYBOOK_LABELS.button.danger}</Button>
</Story>

<Story name="Ghost">
  <Button variant="ghost">{STORYBOOK_LABELS.button.ghost}</Button>
</Story>

<Story name="Success">
  <Button variant="success">{STORYBOOK_LABELS.button.success}</Button>
</Story>

<Story name="Outline">
  <Button variant="outline">{STORYBOOK_LABELS.button.outline}</Button>
</Story>

<Story name="Small">
  <Button variant="primary" size="sm">{STORYBOOK_LABELS.button.small}</Button>
</Story>

<Story name="Large">
  <Button variant="primary" size="lg">{STORYBOOK_LABELS.button.large}</Button>
</Story>

<Story name="Disabled">
  <Button variant="primary" disabled>{STORYBOOK_LABELS.button.disabled}</Button>
</Story>

<Story name="AllVariants">
  <div class="flex gap-2 flex-wrap items-center">
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="danger">Danger</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="success">Success</Button>
    <Button variant="outline">Outline</Button>
  </div>
</Story>

<Story name="AllSizes">
  <div class="flex gap-2 items-center">
    <Button variant="primary" size="sm">Small</Button>
    <Button variant="primary" size="md">Medium</Button>
    <Button variant="primary" size="lg">Large</Button>
  </div>
</Story>