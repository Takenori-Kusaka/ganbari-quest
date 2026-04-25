<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'outline' | 'warning';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = HTMLButtonAttributes & {
	href?: undefined;
	variant?: Variant;
	size?: Size;
	children: Snippet;
};

type AnchorProps = HTMLAnchorAttributes & {
	href: string;
	variant?: Variant;
	size?: Size;
	children: Snippet;
};

type Props = ButtonProps | AnchorProps;

let {
	variant = 'primary',
	size = 'md',
	children,
	class: className = '',
	href,
	...rest
}: Props = $props();

const variantClasses: Record<Variant, string> = {
	primary: 'bg-[var(--theme-primary)] text-white hover:brightness-90 active:brightness-80',
	secondary:
		'bg-[var(--theme-secondary)] text-[var(--color-text)] hover:brightness-95 active:brightness-90',
	danger: 'bg-[var(--color-danger)] text-white hover:brightness-90 active:brightness-80',
	ghost: 'bg-transparent text-[var(--color-text-muted)] hover:bg-black/5 active:bg-black/10',
	success: 'bg-[var(--color-success)] text-white hover:brightness-90 active:brightness-80',
	outline:
		'bg-transparent text-[var(--theme-primary)] border-2 border-[var(--theme-primary)] hover:bg-[color-mix(in_srgb,var(--theme-primary)_10%,transparent)] active:bg-[color-mix(in_srgb,var(--theme-primary)_20%,transparent)]',
	warning: 'bg-[var(--color-warning)] text-white hover:brightness-90 active:brightness-80',
};

const sizeClasses: Record<Size, string> = {
	sm: 'px-4 py-2 text-sm rounded-[var(--radius-sm)]',
	md: 'px-6 py-3 text-md rounded-[var(--radius-md)] min-h-12',
	lg: 'px-8 py-5 text-xl rounded-[var(--radius-lg)] min-h-20 font-bold',
};

const baseClass = $derived(
	`tap-target inline-flex items-center justify-center font-bold transition-all ${variantClasses[variant]} ${sizeClasses[size]} ${className}`,
);
</script>

{#if href !== undefined}
<a
	{href}
	class={baseClass}
	{...rest as HTMLAnchorAttributes}
>
	{@render children()}
</a>
{:else}
<button
	class={baseClass}
	{...rest as HTMLButtonAttributes}
>
	{@render children()}
</button>
{/if}
