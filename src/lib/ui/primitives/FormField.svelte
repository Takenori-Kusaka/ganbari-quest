<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLInputAttributes } from 'svelte/elements';

type InputType =
	| 'text'
	| 'email'
	| 'password'
	| 'number'
	| 'tel'
	| 'url'
	| 'search'
	| 'date'
	| 'time'
	| 'datetime-local';

interface Props extends Omit<HTMLInputAttributes, 'type'> {
	label: string;
	type?: InputType;
	error?: string;
	hint?: string;
	value?: string | number;
	/** #587: type="password" 時に表示/非表示トグルを付けるか */
	showToggle?: boolean;
	/** Override default input with custom content (e.g. textarea, select) */
	children?: Snippet;
}

let {
	label,
	type = 'text',
	error,
	hint,
	id,
	value = $bindable(),
	showToggle = false,
	children,
	class: className = '',
	...rest
}: Props = $props();

const fieldId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
let passwordVisible = $state(false);
const effectiveType = $derived(
	type === 'password' && showToggle && passwordVisible ? 'text' : type,
);
</script>

<div class="flex flex-col gap-1 {className}">
	<label for={fieldId} class="text-sm font-medium text-[var(--color-text)]">
		{label}
	</label>
	{#if children}
		{@render children()}
	{:else}
		<div class="relative">
			<input
				type={effectiveType}
				id={fieldId}
				bind:value
				class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm
					{error
					? 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]'
					: 'border-[var(--input-border)] focus:border-[var(--input-border-focus)]'}
					focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors
					{showToggle && type === 'password' ? 'pr-10' : ''}"
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
				{...rest}
			/>
			{#if showToggle && type === 'password'}
				<button
					type="button"
					class="password-toggle"
					onclick={() => { passwordVisible = !passwordVisible; }}
					aria-label={passwordVisible ? 'パスワードを非表示' : 'パスワードを表示'}
				>
					{#if passwordVisible}
						<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
					{/if}
				</button>
			{/if}
		</div>
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

<style>
	.password-toggle {
		position: absolute;
		top: 50%;
		right: 8px;
		transform: translateY(-50%);
		padding: 4px;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		transition: color 0.15s;
	}

	.password-toggle:hover {
		color: var(--color-text);
	}

	.password-toggle:focus-visible {
		outline: 2px solid var(--color-brand-500);
		outline-offset: 2px;
	}
</style>
