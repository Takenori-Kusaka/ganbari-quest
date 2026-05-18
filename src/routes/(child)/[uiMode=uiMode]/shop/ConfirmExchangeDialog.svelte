<script lang="ts">
// #2155: ごほうび交換確認 Dialog 内部レイアウト
// アイコン拡大 + 階層化表示 + 「はい」ボタン強調 + #2158 感情演出 trigger を含む。
// Style block 50 行制約を満たすため shop/+page.svelte から分離。

import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { CHILD_SHOP_LABELS } from '$lib/domain/labels';
import { playRewardCelebration } from '$lib/features/reward-celebration';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	open: boolean;
	rewardId: number | null;
	rewardTitle: string;
	rewardPoints: number;
	rewardIcon: string | null;
	onClose: () => void;
}

let {
	open = $bindable(),
	rewardId,
	rewardTitle,
	rewardPoints,
	rewardIcon,
	onClose,
}: Props = $props();

let isSubmitting = $state(false);
</script>

<Dialog
	bind:open
	closable={false}
	ariaLabel={CHILD_SHOP_LABELS.exchangeDialogAriaLabel}
	testid="exchange-confirm-dialog"
>
	<div class="confirm-dialog-body">
		<div class="confirm-icon-wrap" aria-hidden="true">
			<span class="confirm-icon">{rewardIcon ?? '🎁'}</span>
		</div>

		<h2 class="confirm-heading">{CHILD_SHOP_LABELS.exchangeConfirmHeading}</h2>
		<p class="confirm-reward-title" data-testid="confirm-reward-title">
			{rewardTitle}
		</p>
		<div class="confirm-points-block" data-testid="confirm-reward-points">
			<span class="confirm-points-label">{CHILD_SHOP_LABELS.exchangeConfirmPointsLabel}</span>
			<p class="confirm-points-value">
				<span class="confirm-points-num">{rewardPoints}</span>
				<span class="confirm-points-unit">{CHILD_SHOP_LABELS.pointUnit}</span>
			</p>
		</div>
		<p class="confirm-description">{CHILD_SHOP_LABELS.exchangeConfirmDescription}</p>

		<div class="confirm-actions">
			<form
				method="POST"
				action="?/requestExchange"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ result, update }) => {
						isSubmitting = false;
						if (result.type === 'success' || result.type === 'redirect') {
							onClose();
							void playRewardCelebration();
							await invalidateAll();
						} else {
							await update();
							onClose();
						}
					};
				}}
				class="confirm-yes-form"
			>
				<input type="hidden" name="rewardId" value={rewardId} />
				<div class="confirm-yes-pulse">
					<Button
						type="submit"
						variant="primary"
						size="lg"
						disabled={isSubmitting}
						data-testid="confirm-exchange-yes"
					>
						{CHILD_SHOP_LABELS.exchangeConfirmYes}
					</Button>
				</div>
			</form>
			<Button variant="ghost" size="sm" onclick={onClose} data-testid="confirm-exchange-cancel">
				{CHILD_SHOP_LABELS.exchangeConfirmCancel}
			</Button>
		</div>
	</div>
</Dialog>

<style>
	.confirm-dialog-body {
		display: flex;
		flex-direction: column;
		gap: var(--sp-sm);
		align-items: center;
		text-align: center;
		padding: var(--sp-md) 0;
	}
	.confirm-icon-wrap {
		width: 96px;
		height: 96px;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: var(--color-surface-warm);
		border-radius: var(--radius-full);
		margin-bottom: var(--sp-sm);
	}
	.confirm-icon { font-size: 4rem; line-height: 1; }
	.confirm-heading { font-size: 1.1rem; font-weight: bold; margin: 0; color: var(--color-text); }
	.confirm-reward-title { font-size: 1.25rem; font-weight: bold; margin: 0; color: var(--color-text); }
	.confirm-points-block {
		display: flex; flex-direction: column; align-items: center; gap: 2px;
		background-color: var(--color-surface-warm);
		padding: var(--sp-sm) var(--sp-md);
		border-radius: var(--radius-md);
		margin-top: var(--sp-xs);
	}
	.confirm-points-label { font-size: 0.85rem; color: var(--color-text-warm-muted); }
	.confirm-points-value { margin: 0; display: flex; align-items: baseline; gap: 4px; }
	.confirm-points-num { font-size: 2rem; font-weight: bold; color: var(--color-text-warm); }
	.confirm-points-unit { font-size: 0.9rem; color: var(--color-text-warm-muted); }
	.confirm-description { font-size: 0.85rem; color: var(--color-text-muted); margin: 0; }
	.confirm-actions {
		display: flex; flex-direction: column; gap: var(--sp-sm);
		width: 100%; align-items: center; margin-top: var(--sp-md);
	}
	.confirm-yes-form { width: 100%; display: flex; justify-content: center; }
	.confirm-yes-pulse {
		animation: confirm-yes-pulse 1.4s ease-in-out 3;
		border-radius: var(--radius-lg);
	}
	@keyframes confirm-yes-pulse {
		0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--theme-primary) 40%, transparent); }
		50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--theme-primary) 0%, transparent); }
	}
	@media (prefers-reduced-motion: reduce) {
		.confirm-yes-pulse { animation: none; }
	}
</style>
