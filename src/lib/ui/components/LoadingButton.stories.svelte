<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import LoadingButton from './LoadingButton.svelte';

const { Story } = defineMeta({
	title: 'Components/LoadingButton',
	component: LoadingButton,
	tags: ['autodocs'],
});
</script>

<Story name="Primary (Idle)">
  <LoadingButton variant="primary" class="px-6 py-2 rounded-lg bg-blue-600 text-white">
    {STORYBOOK_LABELS.loadingButton.save}
  </LoadingButton>
</Story>

<Story name="Primary (Loading)">
  <LoadingButton variant="primary" loading={true} class="px-6 py-2 rounded-lg bg-blue-600 text-white">
    {STORYBOOK_LABELS.loadingButton.save}
  </LoadingButton>
</Story>

<Story name="Primary (Loading with Custom Text)">
  <LoadingButton variant="primary" loading={true} loadingText={STORYBOOK_LABELS.loadingButton.saving} class="px-6 py-2 rounded-lg bg-blue-600 text-white">
    {STORYBOOK_LABELS.loadingButton.save}
  </LoadingButton>
</Story>

<Story name="Primary (Disabled)">
  <LoadingButton variant="primary" disabled={true} class="px-6 py-2 rounded-lg bg-blue-600 text-white">
    {STORYBOOK_LABELS.loadingButton.save}
  </LoadingButton>
</Story>

<Story name="Child Variant (Idle)">
  <LoadingButton variant="child" class="px-8 py-3 rounded-xl bg-green-500 text-white text-lg">
    {STORYBOOK_LABELS.loadingButton.child}
  </LoadingButton>
</Story>

<Story name="Child Variant (Loading)">
  <LoadingButton variant="child" loading={true} loadingText={STORYBOOK_LABELS.loadingButton.childSaving} class="px-8 py-3 rounded-xl bg-green-500 text-white text-lg">
    {STORYBOOK_LABELS.loadingButton.child}
  </LoadingButton>
</Story>

<Story name="Child Variant (Disabled)">
  <LoadingButton variant="child" disabled={true} class="px-8 py-3 rounded-xl bg-green-500 text-white text-lg">
    {STORYBOOK_LABELS.loadingButton.child}
  </LoadingButton>
</Story>

<Story name="All States Comparison">
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <span class="text-xs w-16 text-gray-500">Idle</span>
      <LoadingButton variant="primary" class="px-6 py-2 rounded-lg bg-blue-600 text-white">
        {STORYBOOK_LABELS.loadingButton.send}
      </LoadingButton>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-xs w-16 text-gray-500">Loading</span>
      <LoadingButton variant="primary" loading={true} loadingText={STORYBOOK_LABELS.loadingButton.sending} class="px-6 py-2 rounded-lg bg-blue-600 text-white">
        {STORYBOOK_LABELS.loadingButton.send}
      </LoadingButton>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-xs w-16 text-gray-500">Disabled</span>
      <LoadingButton variant="primary" disabled={true} class="px-6 py-2 rounded-lg bg-blue-600 text-white">
        {STORYBOOK_LABELS.loadingButton.send}
      </LoadingButton>
    </div>
  </div>
</Story>

<Story name="Variant Comparison">
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <span class="text-xs w-16 text-gray-500">Primary</span>
      <LoadingButton variant="primary" loading={true} class="px-6 py-2 rounded-lg bg-blue-600 text-white">
        {STORYBOOK_LABELS.loadingButton.save}
      </LoadingButton>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-xs w-16 text-gray-500">Child</span>
      <LoadingButton variant="child" loading={true} loadingText={STORYBOOK_LABELS.loadingButton.childSaving} class="px-8 py-3 rounded-xl bg-green-500 text-white text-lg">
        {STORYBOOK_LABELS.loadingButton.child}
      </LoadingButton>
    </div>
  </div>
</Story>
