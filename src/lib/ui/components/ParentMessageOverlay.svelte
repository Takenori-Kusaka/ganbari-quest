<script lang="ts">
import { getChildParentMessageLabels } from '$lib/domain/labels';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface Props {
	open: boolean;
	messageType: string;
	stampLabel: string;
	body: string | null;
	icon: string;
	/**
	 * #4688 (F4): 応援 (cheer) で親が付けたボーナスポイント。残高は増えているのにダイアログに
	 * 出ていなかったため、「何がもらえたのか」が子供に伝わらなかった。0 / null なら出さない。
	 */
	bonusPoints?: number | null;
	/** 年齢帯 (docs/DESIGN.md §8)。文言の出し分けに使う — 画面側で判定しない */
	uiMode?: string;
	onClose?: () => void;
}

let {
	open = $bindable(),
	messageType,
	stampLabel,
	body,
	icon,
	bonusPoints = null,
	uiMode = 'elementary',
	onClose,
}: Props = $props();

// 文言は年齢帯 variant を labels SSOT から引く (`src/routes/CLAUDE.md` §年齢帯 variant)。
const t = $derived(getChildParentMessageLabels(uiMode));

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
		<p class="text-lg font-bold text-[var(--color-action-primary)]">{t.parentMessageTitle}</p>

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
			<p class="{body.length > 30 ? 'text-sm' : 'text-lg'} font-bold leading-relaxed max-h-40 overflow-y-auto px-2">{t.parentMessageBody(body)}</p>
		{/if}

		{#if bonusPoints && bonusPoints > 0}
			<p class="text-xl font-bold text-[var(--color-point)]" data-testid="parent-message-bonus">
				{t.parentMessageBonusPoints(bonusPoints)}
			</p>
		{/if}

		<p class="text-sm text-[var(--color-text-muted)]">{t.parentMessageFrom}</p>

		<button
			class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--color-action-primary-strong)] text-white font-bold text-lg mt-[var(--sp-sm)]"
			onclick={handleClose}
		>
			{t.parentMessageConfirmBtn}
		</button>
	</div>
</Dialog>
