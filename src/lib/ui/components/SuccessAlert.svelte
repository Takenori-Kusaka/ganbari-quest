<script lang="ts">
interface Props {
	message: string;
}

let { message }: Props = $props();
</script>

<div
	class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-700"
	role="status"
>
	<div class="flex items-center gap-2">
		<span class="flex-shrink-0">✅</span>
		<p class="font-medium">{message}</p>
	</div>
</div>
