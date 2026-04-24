<script lang="ts">
import type { HTMLSelectAttributes } from 'svelte/elements';

interface SelectOption {
	value: string | number;
	label: string;
	disabled?: boolean;
}

interface Props extends Omit<HTMLSelectAttributes, 'value'> {
	label?: string;
	options: SelectOption[];
	value?: string | number | undefined;
	error?: string;
	hint?: string;
	placeholder?: string;
}

let {
	label,
	options,
	value = $bindable(),
	error,
	hint,
	id,
	placeholder,
	class: className = '',
	...rest
}: Props = $props();

const fieldId =
	// svelte-ignore state_referenced_locally
	id ??
	// svelte-ignore state_referenced_locally
	`native-select-${(label ?? 'field').replace(/\s+/g, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="flex flex-col gap-1 {className}">
	{#if label}
		<label for={fieldId} class="text-sm font-medium text-[var(--color-text)]">
			{label}
		</label>
	{/if}
	<select
		id={fieldId}
		bind:value
		class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm
			{error
			? 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]'
			: 'border-[var(--input-border)] focus:border-[var(--input-border-focus)]'}
			focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors
			disabled:opacity-50 disabled:cursor-not-allowed"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
		{...rest}
	>
		{#if placeholder}
			<option value="" disabled selected={value === undefined || value === ''}>
				{placeholder}
			</option>
		{/if}
		{#each options as option (option.value)}
			<option value={option.value} disabled={option.disabled}>
				{option.label}
			</option>
		{/each}
	</select>
	{#if error}
		<p id="{fieldId}-error" class="text-xs text-[var(--color-danger)] mt-0.5" role="alert">
			{error}
		</p>
	{:else if hint}
		<p id="{fieldId}-hint" class="text-xs text-[var(--color-text-muted)] mt-0.5">
			{hint}
		</p>
	{/if}
</div>
