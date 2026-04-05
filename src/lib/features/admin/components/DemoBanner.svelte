<script lang="ts">
interface Props {
	message?: string;
}

let { message = 'デモモードのため、変更はできません' }: Props = $props();
</script>

<div class="bg-[var(--color-gold-100)] border border-[var(--color-gold-300)] rounded-xl px-4 py-3 flex items-center gap-2">
	<span class="text-[var(--color-gold-500)]">&#x26A0;&#xFE0F;</span>
	<p class="text-sm text-[var(--color-gold-700)]">{message}</p>
</div>
