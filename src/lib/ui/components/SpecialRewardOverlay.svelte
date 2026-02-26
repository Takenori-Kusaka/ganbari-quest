<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface Props {
	open: boolean;
	title: string;
	points: number;
	icon: string | null;
	onClose?: () => void;
}

let { open = $bindable(), title, points, icon, onClose }: Props = $props();

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
	<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center py-[var(--spacing-md)]">
		<p class="text-lg font-bold text-[var(--theme-accent)]">🎁 とくべつごほうび！</p>

		<div
			class="w-32 h-32 rounded-[var(--radius-lg)] border-4 border-yellow-400
				bg-gradient-to-b from-yellow-50 to-amber-200 shadow-amber-300/50 shadow-lg
				flex items-center justify-center animate-bounce-in"
		>
			<span class="text-5xl">{icon ?? '🎁'}</span>
		</div>

		<p class="text-xl font-bold">{title}</p>

		<div class="animate-point-pop">
			<p class="text-2xl font-bold text-[var(--color-point)]">+{points} ポイント！</p>
		</div>

		<button
			class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg mt-[var(--spacing-sm)]"
			onclick={handleClose}
		>
			やったー！
		</button>
	</div>
</Dialog>
