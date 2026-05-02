<script lang="ts">
import { getScreenshotMode } from '$lib/features/demo/screenshot-mode.js';

interface Props {
	message?: string;
}

let { message = 'デモモードのため、変更はできません' }: Props = $props();
</script>

<!-- #1792: LP scrshot 撮影時 (`?screenshot=1`) はデモ独自バナーを非表示にし、本番画面と同じ見た目で撮影する -->
{#if !getScreenshotMode()}
<div data-testid="demo-banner" class="bg-[var(--color-gold-100)] border border-[var(--color-gold-300)] rounded-xl px-4 py-3 flex items-center gap-2">
	<span class="text-[var(--color-gold-500)]">&#x26A0;&#xFE0F;</span>
	<p class="text-sm text-[var(--color-gold-700)]">{message}</p>
</div>
{/if}
