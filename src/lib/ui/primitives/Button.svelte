<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
import { UI_PRIMITIVES_LABELS } from '$lib/domain/labels';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'outline' | 'warning';
type Size = 'sm' | 'md' | 'lg';

interface Props extends HTMLButtonAttributes {
	/** リンクとして描画したい場合は href を指定する（<a> タグで描画される） */
	href?: string;
	variant?: Variant;
	size?: Size;
	/**
	 * 非同期処理の実行中フラグ (#2632 CX-DoR #9 NN/G #1 visibility of system status)。
	 * `true` で spinner 表示 + `disabled` + `aria-busy="true"` を強制し、クリック後に
	 * 「処理中である」visible feedback を出す。再クリック誤動作も防止する。
	 * `<button>` 描画時のみ有効（href 指定の `<a>` は navigation のため loading 非対応）。
	 */
	loading?: boolean;
	children: Snippet;
}

let {
	variant = 'primary',
	size = 'md',
	loading = false,
	children,
	class: className = '',
	href,
	disabled,
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
	`tap-target inline-flex items-center justify-center gap-2 font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`,
);
</script>

{#if href !== undefined}
<a
	{href}
	class={baseClass}
	{...(rest as HTMLAnchorAttributes)}
>
	{@render children()}
</a>
{:else}
<button
	class={baseClass}
	disabled={loading || disabled}
	aria-busy={loading}
	{...rest}
>
	{#if loading}
		<span
			class="inline-block w-[1em] h-[1em] border-2 border-current border-r-transparent rounded-full motion-safe:animate-spin"
			aria-hidden="true"
		></span>
		<span class="sr-only">{UI_PRIMITIVES_LABELS.loadingAriaLabel}</span>
	{/if}
	{@render children()}
</button>
{/if}
