<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'warning' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface Props extends HTMLButtonAttributes {
	variant?: Variant;
	size?: Size;
	label: string;
	children: Snippet;
}

let {
	variant = 'ghost',
	size = 'md',
	label,
	children,
	class: className = '',
	...rest
}: Props = $props();

const variantClasses: Record<Variant, string> = {
	// #4645: 白文字を載せる塗りは AA 版を使う (Button.svelte と同じ理由)。
	primary:
		'bg-[var(--color-action-primary-strong)] text-white hover:brightness-90 active:brightness-80',
	secondary:
		'bg-[var(--theme-secondary)] text-[var(--color-text)] hover:brightness-95 active:brightness-90',
	danger: 'bg-red-50 text-red-500 hover:bg-red-100 active:bg-red-200',
	ghost: 'text-[var(--color-text-muted)] hover:bg-black/5 active:bg-black/10',
	warning: 'bg-amber-50 text-amber-600 hover:bg-amber-100 active:bg-amber-200',
	success: 'bg-green-50 text-green-600 hover:bg-green-100 active:bg-green-200',
	outline:
		// #4645: 文字色は AA 版 (枠線は 3:1 で足りるので従来色のまま)。
		'bg-transparent text-[var(--color-action-primary-strong)] border-2 border-[var(--theme-primary)] hover:bg-[color-mix(in_srgb,var(--theme-primary)_10%,transparent)] active:bg-[color-mix(in_srgb,var(--theme-primary)_20%,transparent)]',
};

const sizeClasses: Record<Size, string> = {
	sm: 'p-1 text-xs rounded',
	md: 'p-1.5 text-sm rounded-lg',
	lg: 'p-2 text-base rounded-lg',
};
</script>

<button
	class="tap-target inline-flex items-center justify-center gap-1 font-medium transition-colors {variantClasses[variant]} {sizeClasses[size]} {className}"
	aria-label={label}
	title={label}
	{...rest}
>
	{@render children()}
</button>
