<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

type Variant = 'success' | 'warning' | 'danger' | 'info';

interface Props extends HTMLAttributes<HTMLDivElement> {
	variant?: Variant;
	message?: string;
	children?: Snippet;
}

let {
	variant = 'info',
	message,
	children,
	class: className = '',
	...rest
}: Props = $props();

const variantClasses: Record<Variant, string> = {
	success: 'bg-green-50 border-green-200 text-green-800',
	warning: 'bg-amber-50 border-amber-200 text-amber-800',
	danger: 'bg-red-50 border-red-200 text-red-800',
	info: 'bg-blue-50 border-blue-200 text-blue-800',
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
