<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

type Variant = 'default' | 'elevated' | 'outlined';

interface Props extends HTMLAttributes<HTMLElement> {
	variant?: Variant;
	padding?: 'none' | 'sm' | 'md' | 'lg';
	header?: Snippet;
	footer?: Snippet;
	children: Snippet;
}

let {
	variant = 'default',
	padding = 'md',
	header,
	footer,
	children,
	class: className = '',
	...rest
}: Props = $props();

const variantClasses: Record<Variant, string> = {
	default: 'bg-[var(--card-bg)] shadow-[var(--card-shadow)] border border-[var(--color-border-default)]',
	elevated: 'bg-[var(--card-bg)] shadow-[var(--card-shadow-elevated)]',
	outlined: 'bg-[var(--card-bg)] border border-[var(--color-border-strong)]',
};

const paddingClasses: Record<string, string> = {
	none: '',
	sm: 'p-2',
	md: 'p-4',
	lg: 'p-6',
};
</script>

<section
	class="rounded-[var(--card-radius)] overflow-hidden {variantClasses[variant]} {className}"
	{...rest}
>
	{#if header}
		<div class="px-4 py-3 border-b border-[var(--color-border-default)]">
			{@render header()}
		</div>
	{/if}
	<div class={paddingClasses[padding]}>
		{@render children()}
	</div>
	{#if footer}
		<div class="px-4 py-3 border-t border-[var(--color-border-default)]">
			{@render footer()}
		</div>
	{/if}
</section>
