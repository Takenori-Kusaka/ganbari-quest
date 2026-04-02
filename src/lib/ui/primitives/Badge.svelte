<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';
type Size = 'sm' | 'md';

interface Props extends HTMLAttributes<HTMLSpanElement> {
	variant?: Variant;
	size?: Size;
	children: Snippet;
}

let {
	variant = 'neutral',
	size = 'sm',
	children,
	class: className = '',
	...rest
}: Props = $props();

const variantClasses: Record<Variant, string> = {
	success: 'bg-green-100 text-green-700',
	warning: 'bg-amber-100 text-amber-700',
	danger: 'bg-red-100 text-red-700',
	info: 'bg-blue-100 text-blue-700',
	neutral: 'bg-gray-100 text-gray-600',
	accent: 'bg-[var(--theme-bg)] text-[var(--theme-accent)]',
};

const sizeClasses: Record<Size, string> = {
	sm: 'text-xs px-2 py-0.5',
	md: 'text-sm px-3 py-1',
};
</script>

<span
	class="inline-flex items-center gap-1 rounded-[var(--badge-radius)] font-bold {variantClasses[variant]} {sizeClasses[size]} {className}"
	{...rest}
>
	{@render children()}
</span>
