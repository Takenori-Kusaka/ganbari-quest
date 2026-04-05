<script lang="ts">
interface Props {
	message?: string;
}

let { message = 'デモモードのため、変更はできません' }: Props = $props();
</script>

<div class="bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] rounded-xl px-4 py-3 flex items-center gap-2">
	<span class="text-[var(--color-warning)]">&#x26A0;&#xFE0F;</span>
	<p class="text-sm text-[var(--color-feedback-warning-text)]">{message}</p>
</div>
