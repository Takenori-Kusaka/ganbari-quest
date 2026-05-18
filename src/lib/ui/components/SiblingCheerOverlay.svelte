<!--
  SiblingCheerOverlay.svelte
  - #2107: Ark UI Dialog primitive (`$lib/ui/primitives/Dialog.svelte`) ベースに refactor。
    backdrop click / ESC / focus trap / aria-modal は primitive 側に委譲。
  - #2106: z-index は DESIGN §10 `--z-tutorial` 階層を `zLayer="tutorial"` で適用 (旧生数値 100)。
  - 既存呼び出し側 API (`cheers` / `onDismiss` prop) は維持。
-->
<script lang="ts">
import { enhance } from '$app/forms';
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface CheerData {
	id: number;
	stampLabel: string;
	stampEmoji: string;
	fromName: string;
}

interface Props {
	cheers: CheerData[];
	onDismiss: () => void;
}

let { cheers, onDismiss }: Props = $props();

const cheerIds = $derived(cheers.map((c) => c.id).join(','));
// Dialog primitive は bindable open を取るため local state を経由する。
let dialogOpen = $state(true);

function handleDialogChange(details: { open: boolean }) {
	if (!details.open) {
		onDismiss();
	}
	dialogOpen = details.open;
}
</script>

{#if cheers.length > 0}
	<Dialog
		bind:open={dialogOpen}
		onOpenChange={handleDialogChange}
		zLayer="tutorial"
		size="sm"
		closable={false}
		testid="cheer-overlay"
		ariaLabel={UI_COMPONENTS_LABELS.siblingCheerTitle}
		contentClass="cheer-overlay__content"
	>
		<p class="cheer-overlay__title">{UI_COMPONENTS_LABELS.siblingCheerTitle}</p>
		<div class="cheer-overlay__list">
			{#each cheers as cheer}
				<div class="cheer-overlay__item">
					<span class="cheer-overlay__emoji">{cheer.stampEmoji}</span>
					<div>
						<span class="cheer-overlay__from">{UI_COMPONENTS_LABELS.siblingCheerFrom(cheer.fromName)}</span>
						<span class="cheer-overlay__label">{cheer.stampLabel}</span>
					</div>
				</div>
			{/each}
		</div>
		<form
			method="POST"
			action="?/markCheersShown"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					dialogOpen = false;
					onDismiss();
				};
			}}
		>
			<input type="hidden" name="cheerIds" value={cheerIds} />
			<button type="submit" class="cheer-overlay__btn">{UI_COMPONENTS_LABELS.siblingCheerConfirmBtn}</button>
		</form>
	</Dialog>
{/if}

<style>
	/* Dialog content card inner customization */
	:global(.cheer-overlay__content) {
		text-align: center;
	}

	.cheer-overlay__title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-violet-600, #7c3aed);
		margin-bottom: 12px;
	}

	.cheer-overlay__list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 16px;
	}

	.cheer-overlay__item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: var(--color-premium-50, #f5f3ff);
		border-radius: 8px;
	}

	.cheer-overlay__emoji {
		font-size: 1.5rem;
	}

	.cheer-overlay__from {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		display: block;
	}

	.cheer-overlay__label {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--color-violet-700, #5b21b6);
	}

	.cheer-overlay__btn {
		width: 100%;
		padding: 10px;
		border: none;
		border-radius: 10px;
		background: var(--gradient-premium, linear-gradient(135deg, #8b5cf6, #7c3aed));
		color: white;
		font-size: 0.875rem;
		font-weight: 700;
		cursor: pointer;
	}

	.cheer-overlay__btn:hover {
		filter: brightness(1.05);
	}
</style>
