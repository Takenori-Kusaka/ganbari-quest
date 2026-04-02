<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLInputAttributes } from 'svelte/elements';

type InputType = 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';

interface Props extends Omit<HTMLInputAttributes, 'type'> {
	label: string;
	type?: InputType;
	error?: string;
	hint?: string;
	/** Override default input with custom content (e.g. textarea, select) */
	children?: Snippet;
}

let {
	label,
	type = 'text',
	error,
	hint,
	id,
	children,
	class: className = '',
	...rest
}: Props = $props();

const fieldId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
</script>

<div class="flex flex-col gap-1 {className}">
	<label for={fieldId} class="text-sm font-medium text-[var(--color-text)]">
		{label}
	</label>
	{#if children}
		{@render children()}
	{:else}
		<input
			{type}
			id={fieldId}
			class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm
				{error
				? 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]'
				: 'border-[var(--input-border)] focus:border-[var(--input-border-focus)]'}
				focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors"
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
			{...rest}
		/>
	{/if}
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
