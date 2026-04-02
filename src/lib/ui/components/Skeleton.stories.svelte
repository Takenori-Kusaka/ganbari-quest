<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import Skeleton from './Skeleton.svelte';

const { Story } = defineMeta({
	title: 'Components/Skeleton',
	component: Skeleton,
	tags: ['autodocs'],
});
</script>

<Story name="Default">
  <Skeleton />
</Story>

<Story name="Text Line">
  <Skeleton width="60%" height="1rem" />
</Story>

<Story name="Heading">
  <Skeleton width="40%" height="2rem" />
</Story>

<Story name="Avatar (Circle)">
  <Skeleton width="48px" height="48px" rounded="full" />
</Story>

<Story name="Card">
  <Skeleton width="100%" height="120px" rounded="lg" />
</Story>

<Story name="Rounded Small">
  <Skeleton width="80px" height="24px" rounded="sm" />
</Story>

<Story name="Rounded Full (Pill)">
  <Skeleton width="100px" height="32px" rounded="full" />
</Story>

<Story name="Text Block">
  <div class="flex flex-col gap-2" style="max-width: 400px;">
    <Skeleton width="100%" height="1rem" />
    <Skeleton width="90%" height="1rem" />
    <Skeleton width="75%" height="1rem" />
    <Skeleton width="85%" height="1rem" />
  </div>
</Story>

<Story name="Card Placeholder">
  <div class="flex gap-3 p-4 border rounded-lg" style="max-width: 360px;">
    <Skeleton width="64px" height="64px" rounded="lg" />
    <div class="flex flex-col gap-2 flex-1">
      <Skeleton width="70%" height="1rem" />
      <Skeleton width="50%" height="0.75rem" />
      <Skeleton width="90%" height="0.75rem" />
    </div>
  </div>
</Story>

<Story name="All Rounded Variants">
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-3">
      <Skeleton width="120px" height="32px" rounded="sm" />
      <span class="text-xs text-gray-500">sm</span>
    </div>
    <div class="flex items-center gap-3">
      <Skeleton width="120px" height="32px" rounded="md" />
      <span class="text-xs text-gray-500">md</span>
    </div>
    <div class="flex items-center gap-3">
      <Skeleton width="120px" height="32px" rounded="lg" />
      <span class="text-xs text-gray-500">lg</span>
    </div>
    <div class="flex items-center gap-3">
      <Skeleton width="120px" height="32px" rounded="full" />
      <span class="text-xs text-gray-500">full</span>
    </div>
  </div>
</Story>
