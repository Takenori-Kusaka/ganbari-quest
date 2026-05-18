<script lang="ts">
import { Dialog as ArkDialog } from '@ark-ui/svelte/dialog';
import { Portal } from '@ark-ui/svelte/portal';
import type { Snippet } from 'svelte';
import { UI_PRIMITIVES_LABELS } from '$lib/domain/labels';

interface Props {
	open: boolean;
	onOpenChange?: (details: { open: boolean }) => void;
	children: Snippet;
	title?: string;
	closable?: boolean;
	testid?: string;
	size?: 'sm' | 'md' | 'lg';
	ariaLabel?: string;
	/**
	 * Z-index 階層 (#2106 / #2107、DESIGN §10 整合)。
	 * - 'modal' (既定): backdrop=--z-overlay (40) / content=--z-modal (50)
	 * - 'tutorial': backdrop / content 共に --z-tutorial (100、SiblingCheerOverlay 等)
	 * - 'celebration': backdrop / content 共に --z-celebration (200、SiblingCelebration 等)
	 */
	zLayer?: 'modal' | 'tutorial' | 'celebration';
	/** content (card 内側) 追加 class。背景色・padding 上書き等の特殊レイアウト用 */
	contentClass?: string;
	/** backdrop 追加 class (色変更等) */
	backdropClass?: string;
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
	zLayer = 'modal',
	contentClass = '',
	backdropClass = '',
}: Props = $props();

const sizeClasses: Record<NonNullable<Props['size']>, string> = {
	sm: 'max-w-[min(20rem,calc(100vw-1rem))]',
	md: 'max-w-[min(28rem,calc(100vw-1rem))]',
	lg: 'max-w-[min(36rem,calc(100vw-1rem))]',
};

// DESIGN §10 z-index トークン (#2106): 生数値 z-40/50 直書きから var(--z-*) に切替。
// Tailwind arbitrary value 経由で var() を埋め込む形は ADR-0042 / DESIGN §10 整合 (token 参照のみ)。
type LayerClasses = Record<NonNullable<Props['zLayer']>, { backdrop: string; positioner: string }>;
const layerClasses: LayerClasses = {
	modal: {
		backdrop: 'z-[var(--z-overlay)]',
		positioner: 'z-[var(--z-modal)]',
	},
	tutorial: {
		backdrop: 'z-[var(--z-tutorial)]',
		positioner: 'z-[var(--z-tutorial)]',
	},
	celebration: {
		backdrop: 'z-[var(--z-celebration)]',
		positioner: 'z-[var(--z-celebration)]',
	},
};
const layer = $derived(layerClasses[zLayer]);

function handleOpenChange(details: { open: boolean }) {
	open = details.open;
	onOpenChange?.(details);
}
</script>

<ArkDialog.Root {open} onOpenChange={handleOpenChange} closeOnInteractOutside={closable}>
	<Portal>
		<ArkDialog.Backdrop
			class="fixed inset-0 {layer.backdrop} bg-black/50 backdrop-blur-sm transition-opacity {backdropClass}"
		/>
		<ArkDialog.Positioner class="fixed inset-0 {layer.positioner} flex items-center justify-center p-2 sm:p-[var(--sp-md)]">
			<ArkDialog.Content
				class="bg-white rounded-[var(--radius-lg)] shadow-xl w-full min-w-[280px] {sizeClasses[size]} max-h-[90dvh] overflow-y-auto p-[var(--sp-lg)] {contentClass}"
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
						aria-label={UI_PRIMITIVES_LABELS.closeAriaLabel}
					>
						✕
					</ArkDialog.CloseTrigger>
				{/if}
			</ArkDialog.Content>
		</ArkDialog.Positioner>
	</Portal>
</ArkDialog.Root>
