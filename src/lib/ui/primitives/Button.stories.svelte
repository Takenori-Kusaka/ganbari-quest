<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import Button from './Button.svelte';

const L = STORYBOOK_LABELS.button;

const { Story } = defineMeta({
	title: 'Primitives/Button',
	component: Button,
	tags: ['autodocs'],
});
</script>

<Story name="Primary">
  <Button variant="primary">{L.primary}</Button>
</Story>

<Story name="Secondary">
  <Button variant="secondary">{L.secondary}</Button>
</Story>

<Story name="Danger">
  <Button variant="danger">{L.danger}</Button>
</Story>

<Story name="Ghost">
  <Button variant="ghost">{L.ghost}</Button>
</Story>

<Story name="Success">
  <Button variant="success">{L.success}</Button>
</Story>

<Story name="Outline">
  <Button variant="outline">{L.outline}</Button>
</Story>

<Story name="Small">
  <Button variant="primary" size="sm">{L.small}</Button>
</Story>

<Story name="Large">
  <Button variant="primary" size="lg">{L.large}</Button>
</Story>

<Story name="Disabled">
  <Button variant="primary" disabled>{L.disabled}</Button>
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
