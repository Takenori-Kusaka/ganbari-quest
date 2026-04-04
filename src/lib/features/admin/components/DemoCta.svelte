<script lang="ts">
interface Props {
	title?: string;
	description?: string;
	ctaText?: string;
	ctaHref?: string;
}

let {
	title = 'いかがでしたか？',
	description = 'お子さまの「がんばり」を冒険に変えませんか？',
	ctaText = '無料で はじめる →',
	ctaHref = '/demo/signup',
}: Props = $props();
</script>

<div class="bg-gradient-to-r from-[var(--color-feedback-warning-bg)] to-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-xl p-4 text-center">
	<p class="text-sm font-bold text-[var(--color-text)] mb-1">{title}</p>
	<p class="text-xs text-[var(--color-text-muted)] mb-3">{description}</p>
	<a
		href={ctaHref}
		class="inline-block w-full py-2.5 bg-gradient-to-r from-[var(--color-warning)] to-[var(--color-warning)] text-white font-bold rounded-xl text-center text-sm"
	>
		{ctaText}
	</a>
</div>
