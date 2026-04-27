<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import Badge from './Badge.svelte';

const L = STORYBOOK_LABELS.badge;

const { Story } = defineMeta({
	title: 'Primitives/Badge',
	component: Badge,
	tags: ['autodocs'],
});
</script>

<Story name="Success"><Badge variant="success">{L.success}</Badge></Story>
<Story name="Warning"><Badge variant="warning">{L.warning}</Badge></Story>
<Story name="Danger"><Badge variant="danger">{L.danger}</Badge></Story>
<Story name="Info"><Badge variant="info">{L.info}</Badge></Story>
<Story name="Neutral"><Badge variant="neutral">{L.neutral}</Badge></Story>
<Story name="Accent"><Badge variant="accent">{L.accent}</Badge></Story>

<Story name="AllVariants">
  <div class="flex gap-2 flex-wrap items-center">
    <Badge variant="success">{L.success}</Badge>
    <Badge variant="warning">{L.warning}</Badge>
    <Badge variant="danger">{L.danger}</Badge>
    <Badge variant="info">{L.info}</Badge>
    <Badge variant="neutral">{L.neutral}</Badge>
    <Badge variant="accent">{L.accent}</Badge>
  </div>
</Story>

<Story name="SmallSize">
  <div class="flex gap-2">
    <Badge variant="success" size="sm">{L.small}</Badge>
    <Badge variant="success" size="md">{L.medium}</Badge>
  </div>
</Story>
