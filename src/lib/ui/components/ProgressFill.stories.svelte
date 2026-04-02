<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import ProgressFill from './ProgressFill.svelte';

const { Story } = defineMeta({
	title: 'Components/ProgressFill',
	component: ProgressFill,
	tags: ['autodocs'],
});
</script>

<Story name="Default (No Color)">
  <div class="h-3 rounded-full bg-gray-200 overflow-hidden" style="width: 300px;">
    <ProgressFill pct={60} class="h-full rounded-full bg-blue-500" />
  </div>
</Story>

<Story name="With Dynamic Color">
  <div class="h-3 rounded-full bg-gray-200 overflow-hidden" style="width: 300px;">
    <ProgressFill pct={75} color="#22c55e" class="h-full rounded-full" />
  </div>
</Story>

<Story name="Empty (0%)">
  <div class="h-3 rounded-full bg-gray-200 overflow-hidden" style="width: 300px;">
    <ProgressFill pct={0} color="#3b82f6" class="h-full rounded-full" />
  </div>
</Story>

<Story name="Full (100%)">
  <div class="h-3 rounded-full bg-gray-200 overflow-hidden" style="width: 300px;">
    <ProgressFill pct={100} color="#3b82f6" class="h-full rounded-full" />
  </div>
</Story>

<Story name="Progress Steps">
  <div class="flex flex-col gap-3" style="width: 300px;">
    {#each [10, 25, 50, 75, 90, 100] as pct}
      <div class="flex items-center gap-2">
        <span class="text-xs w-8 text-right text-gray-500">{pct}%</span>
        <div class="h-3 rounded-full bg-gray-200 overflow-hidden flex-1">
          <ProgressFill {pct} color="#6366f1" class="h-full rounded-full transition-all" />
        </div>
      </div>
    {/each}
  </div>
</Story>

<Story name="Color Variations">
  <div class="flex flex-col gap-3" style="width: 300px;">
    <div class="h-4 rounded-full bg-gray-200 overflow-hidden">
      <ProgressFill pct={70} color="#ef4444" class="h-full rounded-full" />
    </div>
    <div class="h-4 rounded-full bg-gray-200 overflow-hidden">
      <ProgressFill pct={70} color="#f59e0b" class="h-full rounded-full" />
    </div>
    <div class="h-4 rounded-full bg-gray-200 overflow-hidden">
      <ProgressFill pct={70} color="#22c55e" class="h-full rounded-full" />
    </div>
    <div class="h-4 rounded-full bg-gray-200 overflow-hidden">
      <ProgressFill pct={70} color="#3b82f6" class="h-full rounded-full" />
    </div>
    <div class="h-4 rounded-full bg-gray-200 overflow-hidden">
      <ProgressFill pct={70} color="#8b5cf6" class="h-full rounded-full" />
    </div>
  </div>
</Story>

<Story name="Thick Bar">
  <div class="h-6 rounded-lg bg-gray-200 overflow-hidden" style="width: 300px;">
    <ProgressFill pct={45} color="#f97316" class="h-full rounded-lg" />
  </div>
</Story>
