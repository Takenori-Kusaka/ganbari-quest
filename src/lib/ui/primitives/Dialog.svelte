<script lang="ts">
	import { Dialog as ArkDialog } from '@ark-ui/svelte/dialog';
	import { Portal } from '@ark-ui/svelte/portal';
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		onOpenChange?: (details: { open: boolean }) => void;
		children: Snippet;
		title?: string;
		closable?: boolean;
	}

	let { open = $bindable(), onOpenChange, children, title, closable = true }: Props = $props();

	function handleOpenChange(details: { open: boolean }) {
		open = details.open;
		onOpenChange?.(details);
	}
</script>

<ArkDialog.Root {open} onOpenChange={handleOpenChange} closeOnInteractOutside={closable}>
	<Portal>
		<ArkDialog.Backdrop
			class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity"
		/>
		<ArkDialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-[var(--spacing-md)]">
			<ArkDialog.Content
				class="bg-white rounded-[var(--radius-lg)] shadow-xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-[var(--spacing-lg)]"
			>
				{#if title}
					<ArkDialog.Title class="text-xl font-bold mb-[var(--spacing-md)]">
						{title}
					</ArkDialog.Title>
				{/if}
				{@render children()}
				{#if closable}
					<ArkDialog.CloseTrigger
						class="absolute top-3 right-3 tap-target w-10 h-10 flex items-center justify-center rounded-[var(--radius-full)] text-[var(--color-text-muted)] hover:bg-black/5"
						aria-label="とじる"
					>
						✕
					</ArkDialog.CloseTrigger>
				{/if}
			</ArkDialog.Content>
		</ArkDialog.Positioner>
	</Portal>
</ArkDialog.Root>
