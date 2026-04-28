<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import Card from './Card.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Card',
	component: Card,
	tags: ['autodocs'],
});
</script>

<Story name="Default"><Card padding="md"><p>{STORYBOOK_LABELS.card.default}</p></Card></Story>
<Story name="Elevated"><Card variant="elevated" padding="md"><p>{STORYBOOK_LABELS.card.elevated}</p></Card></Story>
<Story name="Outlined"><Card variant="outlined" padding="md"><p>{STORYBOOK_LABELS.card.outlined}</p></Card></Story>

<Story name="AllVariants">
  <div class="flex gap-4 flex-wrap">
    <Card variant="default" padding="md"><p>Default</p></Card>
    <Card variant="elevated" padding="md"><p>Elevated</p></Card>
    <Card variant="outlined" padding="md"><p>Outlined</p></Card>
  </div>
</Story>

<Story name="Paddings">
  <div class="flex gap-4 flex-wrap">
    <Card variant="outlined" padding="none"><p>None</p></Card>
    <Card variant="outlined" padding="sm"><p>Small</p></Card>
    <Card variant="outlined" padding="md"><p>Medium</p></Card>
    <Card variant="outlined" padding="lg"><p>Large</p></Card>
  </div>
</Story>