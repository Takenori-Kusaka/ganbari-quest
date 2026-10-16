<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';
import { UI_PRIMITIVES_LABELS } from '$lib/domain/labels';

/**
 * 重大度は色 + アイコンだけでなく、視覚的に隠れたラベル (sr-only) でも伝える (#4572)。
 * アイコンは aria-hidden のため、ラベルが無いとスクリーンリーダー利用者には danger と info の区別が届かない。
 *
 * **role="alert" は動的に挿入されたときだけ読み上げられる。** ページ描画時から在る Alert は
 * 読み上げ通知されず、利用者が読み進めたときに本文として読まれる。だから重大度のラベルは
 * role に頼らず本文側に持たせている。「操作の結果として後から出す」Alert と「最初から在る」Alert で
 * 読み上げの期待が違う点に注意する。
 */

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
		<span class="sr-only">{UI_PRIMITIVES_LABELS.alertSeverity[variant]}</span>
		{#if message}
			<p>{message}</p>
		{/if}
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>
