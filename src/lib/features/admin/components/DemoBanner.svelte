<script lang="ts">
interface Props {
	message?: string;
}

let { message = 'デモモードのため、変更はできません' }: Props = $props();
</script>

<div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
	<span class="text-amber-500">&#x26A0;&#xFE0F;</span>
	<p class="text-sm text-amber-700">{message}</p>
</div>
