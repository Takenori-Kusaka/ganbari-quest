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
    <Card variant="default" padding="md"><p>{STORYBOOK_LABELS.card.default}</p></Card>
    <Card variant="elevated" padding="md"><p>{STORYBOOK_LABELS.card.elevated}</p></Card>
    <Card variant="outlined" padding="md"><p>{STORYBOOK_LABELS.card.outlined}</p></Card>
  </div>
</Story>

<Story name="Paddings">
  <div class="flex gap-4 flex-wrap">
    <Card variant="outlined" padding="none"><p>{STORYBOOK_LABELS.card.paddingNone}</p></Card>
    <Card variant="outlined" padding="sm"><p>{STORYBOOK_LABELS.card.paddingSm}</p></Card>
    <Card variant="outlined" padding="md"><p>{STORYBOOK_LABELS.card.paddingMd}</p></Card>
    <Card variant="outlined" padding="lg"><p>{STORYBOOK_LABELS.card.paddingLg}</p></Card>
  </div>
</Story>