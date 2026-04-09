<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

type Variant = 'success' | 'warning' | 'danger' | 'info';

interface Props extends HTMLAttributes<HTMLDivElement> {
	variant?: Variant;
	message?: string;
	children?: Snippet;
}

let { variant = 'info', message, children, class: className = '', ...rest }: Props = $props();

const variantClasses: Record<Variant, string> = {
	success:
		'bg-[var(--color-feedback-success-bg)] border-[var(--color-feedback-success-border)] text-[var(--color-feedback-success-text)]',
	warning:
		'bg-[var(--color-feedback-warning-bg)] border-[var(--color-feedback-warning-border)] text-[var(--color-feedback-warning-text)]',
	danger:
		'bg-[var(--color-feedback-error-bg)] border-[var(--color-feedback-error-border)] text-[var(--color-feedback-error-text)]',
	info: 'bg-[var(--color-feedback-info-bg)] border-[var(--color-feedback-info-border)] text-[var(--color-feedback-info-text)]',
};

const iconMap: Record<Variant, string> = {
	success: '✅',
	warning: '⚠️',
	danger: '❌',
	info: 'ℹ️',
};
</script>

<div
	class="flex items-start gap-3 p-3 rounded-lg border text-sm {variantClasses[variant]} {className}"
	role={variant === 'danger' ? 'alert' : 'status'}
	{...rest}
>
	<span class="shrink-0 text-base" aria-hidden="true">{iconMap[variant]}</span>
	<div class="flex-1">
		{#if message}
			<p>{message}</p>
		{/if}
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>
