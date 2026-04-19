<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import PinInput from './PinInput.svelte';

const { Story } = defineMeta({
	title: 'Primitives/PinInput',
	component: PinInput,
	tags: ['autodocs'],
});
</script>

<script>
let lastValue = $state('');
let completedValue = $state('');
</script>

<Story name="Default">
  {#snippet children()}
    <div class="flex flex-col gap-3 items-center">
      <p class="text-sm text-[var(--color-text-muted)]">6 桁 PIN を入力 (mask: on)</p>
      <PinInput onComplete={({ valueAsString }) => (completedValue = valueAsString)} />
      {#if completedValue}
        <p class="text-sm">onComplete: <strong>{completedValue}</strong></p>
      {/if}
    </div>
  {/snippet}
</Story>

<Story name="Unmasked">
  {#snippet children()}
    <div class="flex flex-col gap-3 items-center">
      <p class="text-sm text-[var(--color-text-muted)]">mask: off (値が見える)</p>
      <PinInput mask={false} onComplete={({ valueAsString }) => (lastValue = valueAsString)} />
      {#if lastValue}
        <p class="text-sm">入力値: <strong>{lastValue}</strong></p>
      {/if}
    </div>
  {/snippet}
</Story>

<Story name="Length4">
  {#snippet children()}
    <div class="flex flex-col gap-3 items-center">
      <p class="text-sm text-[var(--color-text-muted)]">短い 4 桁 PIN</p>
      <PinInput length={4} />
    </div>
  {/snippet}
</Story>
