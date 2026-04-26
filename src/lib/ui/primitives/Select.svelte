<script lang="ts">
import { Portal } from '@ark-ui/svelte/portal';
import { Select as ArkSelect, createListCollection } from '@ark-ui/svelte/select';
import { UI_PRIMITIVES_LABELS } from '$lib/domain/labels';

interface SelectItem {
	value: string;
	label: string;
}

interface Props {
	label: string;
	items: SelectItem[];
	value?: string[];
	placeholder?: string;
	error?: string;
	disabled?: boolean;
	onValueChange?: (details: { value: string[]; items: SelectItem[] }) => void;
	class?: string;
}

let {
	label,
	items,
	value = $bindable([]),
	placeholder = UI_PRIMITIVES_LABELS.selectPlaceholder,
	error,
	disabled = false,
	onValueChange,
	class: className = '',
}: Props = $props();

const collection = $derived(createListCollection({ items }));

function handleValueChange(details: { value: string[]; items: SelectItem[] }) {
	value = details.value;
	onValueChange?.(details);
}
</script>

<ArkSelect.Root
	{collection}
	{value}
	{disabled}
	onValueChange={handleValueChange}
	positioning={{ placement: 'bottom-start', sameWidth: true }}
>
	<div class="flex flex-col gap-1 {className}">
		<ArkSelect.Label class="text-sm font-medium text-[var(--color-text)]">
			{label}
		</ArkSelect.Label>
		<ArkSelect.Control>
			<ArkSelect.Trigger
				class="w-full flex items-center justify-between px-3 py-2 border rounded-[var(--input-radius)]
					bg-[var(--input-bg)] text-sm transition-colors
					{error
					? 'border-[var(--color-danger)]'
					: 'border-[var(--input-border)] hover:border-[var(--color-border-strong)]'}
					disabled:opacity-50 disabled:cursor-not-allowed"
			>
				<ArkSelect.ValueText {placeholder} class="truncate" />
				<span class="text-[var(--color-text-muted)] text-xs ml-2">▼</span>
			</ArkSelect.Trigger>
		</ArkSelect.Control>
		{#if error}
			<p class="text-xs text-[var(--color-danger)] mt-0.5" role="alert">{error}</p>
		{/if}
	</div>

	<Portal>
		<ArkSelect.Positioner>
			<ArkSelect.Content
				class="bg-white border border-[var(--color-border-default)] rounded-[var(--input-radius)]
					shadow-lg py-1 max-h-60 overflow-auto z-50"
			>
				{#each items as item (item.value)}
					<ArkSelect.Item
						item={{ label: item.label, value: item.value }}
						class="flex items-center px-3 py-2 text-sm cursor-pointer
							hover:bg-[var(--color-surface-muted)] transition-colors
							data-[highlighted]:bg-[var(--color-surface-muted)]
							data-[state=checked]:text-[var(--theme-primary)] data-[state=checked]:font-bold"
					>
						<ArkSelect.ItemText>{item.label}</ArkSelect.ItemText>
						<ArkSelect.ItemIndicator class="ml-auto text-[var(--theme-primary)]">
							✓
						</ArkSelect.ItemIndicator>
					</ArkSelect.Item>
				{/each}
			</ArkSelect.Content>
		</ArkSelect.Positioner>
	</Portal>
</ArkSelect.Root>
