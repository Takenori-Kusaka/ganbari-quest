<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import Card from './Card.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Card',
	component: Card,
	tags: ['autodocs'],
});
</script>

<Story name="Default"><Card padding="md"><p>カードの内容です</p></Card></Story>
<Story name="Elevated"><Card variant="elevated" padding="md"><p>影付きカード</p></Card></Story>
<Story name="Outlined"><Card variant="outlined" padding="md"><p>枠線付きカード</p></Card></Story>

<Story name="AllVariants">
  <div style="display: flex; gap: 16px; flex-wrap: wrap;">
    <Card variant="default" padding="md"><p>Default</p></Card>
    <Card variant="elevated" padding="md"><p>Elevated</p></Card>
    <Card variant="outlined" padding="md"><p>Outlined</p></Card>
  </div>
</Story>

<Story name="Paddings">
  <div style="display: flex; gap: 16px; flex-wrap: wrap;">
    <Card variant="outlined" padding="none"><p>None</p></Card>
    <Card variant="outlined" padding="sm"><p>Small</p></Card>
    <Card variant="outlined" padding="md"><p>Medium</p></Card>
    <Card variant="outlined" padding="lg"><p>Large</p></Card>
  </div>
</Story>
