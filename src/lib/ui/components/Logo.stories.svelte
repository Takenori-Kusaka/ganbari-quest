<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import Logo from './Logo.svelte';

const { Story } = defineMeta({
	title: 'Components/Logo',
	component: Logo,
	tags: ['autodocs'],
});
</script>

<Story name="Symbol (Default)">
  <Logo variant="symbol" />
</Story>

<Story name="Full">
  <Logo variant="full" />
</Story>

<Story name="Compact">
  <Logo variant="compact" />
</Story>

<Story name="Symbol Custom Size">
  <Logo variant="symbol" size={80} />
</Story>

<Story name="Full Custom Size">
  <Logo variant="full" size={320} />
</Story>

<Story name="Compact Custom Size">
  <Logo variant="compact" size={200} />
</Story>

<Story name="All Variants">
  <div class="flex items-center gap-6 flex-wrap">
    <div class="flex flex-col items-center gap-2">
      <Logo variant="symbol" />
      <span class="text-xs text-gray-500">symbol</span>
    </div>
    <div class="flex flex-col items-center gap-2">
      <Logo variant="compact" />
      <span class="text-xs text-gray-500">compact</span>
    </div>
    <div class="flex flex-col items-center gap-2">
      <Logo variant="full" />
      <span class="text-xs text-gray-500">full</span>
    </div>
  </div>
</Story>

<Story name="Size Comparison">
  <div class="flex items-end gap-4">
    <Logo variant="symbol" size={24} />
    <Logo variant="symbol" size={48} />
    <Logo variant="symbol" size={72} />
    <Logo variant="symbol" size={96} />
  </div>
</Story>
