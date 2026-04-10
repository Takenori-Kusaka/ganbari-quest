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
	testid?: string;
	size?: 'sm' | 'md' | 'lg';
	ariaLabel?: string;
}

let {
	open = $bindable(),
	onOpenChange,
	children,
	title,
	closable = true,
	testid,
	size = 'md',
	ariaLabel,
}: Props = $props();

const sizeClasses: Record<NonNullable<Props['size']>, string> = {
	sm: 'max-w-[min(20rem,calc(100vw-1rem))]',
	md: 'max-w-[min(28rem,calc(100vw-1rem))]',
	lg: 'max-w-[min(36rem,calc(100vw-1rem))]',
};

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
		<ArkDialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-[var(--sp-md)]">
			<ArkDialog.Content
				class="bg-white rounded-[var(--radius-lg)] shadow-xl w-full min-w-[280px] {sizeClasses[size]} max-h-[90dvh] overflow-y-auto p-[var(--sp-lg)]"
				data-testid={testid}
				aria-label={!title && ariaLabel ? ariaLabel : undefined}
			>
				{#if title}
					<ArkDialog.Title class="text-xl font-bold mb-[var(--sp-md)]">
						{title}
					</ArkDialog.Title>
				{:else if ariaLabel}
					<ArkDialog.Title class="sr-only">
						{ariaLabel}
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
