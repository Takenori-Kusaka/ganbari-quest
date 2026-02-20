<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
	type Size = 'sm' | 'md' | 'lg';

	interface Props extends HTMLButtonAttributes {
		variant?: Variant;
		size?: Size;
		children: Snippet;
	}

	let { variant = 'primary', size = 'md', children, class: className = '', ...rest }: Props =
		$props();

	const variantClasses: Record<Variant, string> = {
		primary:
			'bg-[var(--theme-primary)] text-white hover:brightness-90 active:brightness-80',
		secondary:
			'bg-[var(--theme-secondary)] text-[var(--color-text)] hover:brightness-95 active:brightness-90',
		danger: 'bg-[var(--color-danger)] text-white hover:brightness-90 active:brightness-80',
		ghost:
			'bg-transparent text-[var(--color-text-muted)] hover:bg-black/5 active:bg-black/10',
	};

	const sizeClasses: Record<Size, string> = {
		sm: 'px-4 py-2 text-sm rounded-[var(--radius-sm)]',
		md: 'px-6 py-3 text-md rounded-[var(--radius-md)] min-h-12',
		lg: 'px-8 py-5 text-xl rounded-[var(--radius-lg)] min-h-20 font-bold',
	};
</script>

<button
	class="tap-target inline-flex items-center justify-center font-bold transition-all {variantClasses[variant]} {sizeClasses[size]} {className}"
	{...rest}
>
	{@render children()}
</button>
