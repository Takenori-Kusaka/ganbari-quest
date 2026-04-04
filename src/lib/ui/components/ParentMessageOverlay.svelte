<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface Props {
	open: boolean;
	messageType: string;
	stampLabel: string;
	body: string | null;
	icon: string;
	onClose?: () => void;
}

let { open = $bindable(), messageType, stampLabel, body, icon, onClose }: Props = $props();

$effect(() => {
	if (open) {
		soundService.play('special-reward');
	}
});

function handleClose() {
	open = false;
	onClose?.();
}
</script>

<Dialog bind:open closable={false} title="">
	<div class="flex flex-col items-center gap-[var(--sp-md)] text-center py-[var(--sp-md)]">
		<p class="text-lg font-bold text-pink-500">💌 おうえんメッセージ！</p>

		<div
			class="w-32 h-32 rounded-[var(--radius-lg)] border-4 border-pink-300
				bg-gradient-to-b from-pink-50 to-pink-200 shadow-pink-300/50 shadow-lg
				flex items-center justify-center animate-bounce-in"
		>
			<span class="text-5xl">{icon}</span>
		</div>

		{#if messageType === 'stamp'}
			<p class="text-xl font-bold">{stampLabel}</p>
		{:else if body}
			<p class="text-xl font-bold">「{body}」</p>
		{/if}

		<p class="text-sm text-gray-500">パパ・ママからのメッセージだよ</p>

		<button
			class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-pink-500 text-white font-bold text-lg mt-[var(--sp-sm)]"
			onclick={handleClose}
		>
			うれしい！
		</button>
	</div>
</Dialog>
