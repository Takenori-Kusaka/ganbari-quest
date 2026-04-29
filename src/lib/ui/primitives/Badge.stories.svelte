<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import Badge from './Badge.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Badge',
	component: Badge,
	tags: ['autodocs'],
});
</script>

<Story name="Success"><Badge variant="success">{STORYBOOK_LABELS.badge.success}</Badge></Story>
<Story name="Warning"><Badge variant="warning">{STORYBOOK_LABELS.badge.warning}</Badge></Story>
<Story name="Danger"><Badge variant="danger">{STORYBOOK_LABELS.badge.danger}</Badge></Story>
<Story name="Info"><Badge variant="info">{STORYBOOK_LABELS.badge.info}</Badge></Story>
<Story name="Neutral"><Badge variant="neutral">{STORYBOOK_LABELS.badge.neutral}</Badge></Story>
<Story name="Accent"><Badge variant="accent">{STORYBOOK_LABELS.badge.accent}</Badge></Story>

<Story name="AllVariants">
  <div class="flex gap-2 flex-wrap items-center">
    <Badge variant="success">{STORYBOOK_LABELS.badge.success}</Badge>
    <Badge variant="warning">{STORYBOOK_LABELS.badge.warning}</Badge>
    <Badge variant="danger">{STORYBOOK_LABELS.badge.danger}</Badge>
    <Badge variant="info">{STORYBOOK_LABELS.badge.info}</Badge>
    <Badge variant="neutral">{STORYBOOK_LABELS.badge.neutral}</Badge>
    <Badge variant="accent">{STORYBOOK_LABELS.badge.accent}</Badge>
  </div>
</Story>

<Story name="SmallSize">
  <div class="flex gap-2">
    <Badge variant="success" size="sm">{STORYBOOK_LABELS.badge.small}</Badge>
    <Badge variant="success" size="md">{STORYBOOK_LABELS.badge.medium}</Badge>
  </div>
</Story>