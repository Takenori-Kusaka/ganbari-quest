<script lang="ts">
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
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
		<p class="text-lg font-bold text-[var(--color-action-primary)]">{UI_COMPONENTS_LABELS.parentMessageTitle}</p>

		<div
			class="w-32 h-32 rounded-[var(--radius-lg)] border-4 border-[var(--color-action-secondary)]
				bg-gradient-to-b from-[var(--color-surface-muted)] to-[var(--color-action-secondary)] shadow-lg
				flex items-center justify-center animate-bounce-in"
		>
			<span class="text-5xl">{icon}</span>
		</div>

		{#if messageType === 'stamp'}
			<p class="text-xl font-bold">{stampLabel}</p>
		{:else if body}
			<p class="{body.length > 30 ? 'text-sm' : 'text-lg'} font-bold leading-relaxed max-h-40 overflow-y-auto px-2">{UI_COMPONENTS_LABELS.parentMessageBody(body)}</p>
		{/if}

		<p class="text-sm text-[var(--color-text-muted)]">{UI_COMPONENTS_LABELS.parentMessageFrom}</p>

		<button
			class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--color-action-primary)] text-white font-bold text-lg mt-[var(--sp-sm)]"
			onclick={handleClose}
		>
			{UI_COMPONENTS_LABELS.parentMessageConfirmBtn}
		</button>
	</div>
</Dialog>
