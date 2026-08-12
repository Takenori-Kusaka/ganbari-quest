<script lang="ts">
// #2155: ごほうび交換確認 Dialog 内部レイアウト
// アイコン拡大 + 階層化表示 + 「はい」ボタン強調 + #2158 感情演出 trigger を含む。
// Style block 50 行制約を満たすため shop/+page.svelte から分離。
//
// #4407: 個数指定 (単位量のごほうび = 「ゲーム時間 +30分」を 2 時間ぶん = 4 個 交換する) と、
// 交換結果の文字フィードバックを追加。
//   - 個数は残高で買える上限を超えて選べない (+ が disabled になる)
//   - 合計消費ポイント / 交換後の残高を確定前に見せる
//   - 成功・失敗の結果は Toast で出す。画面最上部の Alert だけに頼ると、ごほうびカードまで
//     スクロールしてから押した子供には見えない (#4407 追加報告「押しても反応がない」の実体)

import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { CHILD_SHOP_LABELS } from '$lib/domain/labels';
import { type PointSettings, splitPointDisplay } from '$lib/domain/point-display';
import {
	REDEMPTION_QUANTITY_MAX,
	REDEMPTION_QUANTITY_MIN,
} from '$lib/domain/validation/special-reward';
// #4448: 消費ぶんを `-N` (赤) としてヘッダー残高へ飛ばす
import {
	animateBalanceChange,
	captureFlightOrigin,
} from '$lib/features/point-flight/point-flight.svelte';
import { playRewardCelebration } from '$lib/features/reward-celebration';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';
import QuantityStepper from './QuantityStepper.svelte';

interface Props {
	open: boolean;
	rewardId: string | null;
	rewardTitle: string;
	rewardPoints: number;
	rewardIcon: string | null;
	/** 現在のポイント残高。買える上限個数と「交換後の残り」の算出に使う (#4407)。 */
	balance: number;
	/** 表示単位設定。消費ぶんの `-N` 表示に使う (#4448、pt / 円換算いずれも正しく出す)。 */
	pointSettings: PointSettings;
	onClose: () => void;
}

let {
	open = $bindable(),
	rewardId,
	rewardTitle,
	rewardPoints,
	rewardIcon,
	balance,
	pointSettings,
	onClose,
}: Props = $props();

let isSubmitting = $state(false);
// #4448: 合計消費ポイントの数字が出発点になる
let totalPointsEl = $state<HTMLElement | null>(null);
let quantity = $state(REDEMPTION_QUANTITY_MIN);

// 残高で買える上限。単価 0 の異常データでも 1 以上・上限以下に収める。
const maxAffordable = $derived(
	Math.min(
		REDEMPTION_QUANTITY_MAX,
		Math.max(REDEMPTION_QUANTITY_MIN, rewardPoints > 0 ? Math.floor(balance / rewardPoints) : 1),
	),
);
const totalPoints = $derived(rewardPoints * quantity);
const remainingAfter = $derived(balance - totalPoints);
// #4509 ②: 確定前に見せる数字も一覧・ヘッダーと同じ換算を通す (通貨モードで単位が割れない)。
const totalParts = $derived(
	splitPointDisplay(totalPoints, pointSettings, CHILD_SHOP_LABELS.pointUnit),
);
const remainingAfterText = $derived.by(() => {
	const { amount, unit } = splitPointDisplay(
		remainingAfter,
		pointSettings,
		CHILD_SHOP_LABELS.pointUnit,
	);
	return `${amount}${unit}`;
});

// ごほうびを選び直したら個数を 1 に戻す (前の選択が持ち越されて意図しない個数で確定するのを防ぐ)。
$effect(() => {
	if (rewardId !== null) quantity = REDEMPTION_QUANTITY_MIN;
});
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

		<!-- #4407 AC1: 個数指定。残高で買える上限を超える個数は選べない -->
		<QuantityStepper bind:quantity max={maxAffordable} />

		<div class="confirm-points-block" data-testid="confirm-reward-points">
			<span class="confirm-points-label">
				{quantity > 1
					? CHILD_SHOP_LABELS.totalPointsLabel
					: CHILD_SHOP_LABELS.exchangeConfirmPointsLabel}
			</span>
			<p class="confirm-points-value">
				<span class="confirm-points-num" data-testid="confirm-total-points" bind:this={totalPointsEl}>{totalParts.amount}</span>
				{#if totalParts.unit}
					<span class="confirm-points-unit">{totalParts.unit}</span>
				{/if}
			</p>
			<span class="confirm-points-label" data-testid="confirm-remaining-after">
				{CHILD_SHOP_LABELS.remainingAfterLabel}: {remainingAfterText}
			</span>
		</div>
		<p class="confirm-description">{CHILD_SHOP_LABELS.exchangeConfirmDescription}</p>

		<div class="confirm-actions">
			<form
				method="POST"
				action="?/requestExchange"
				use:enhance={() => {
					isSubmitting = true;
					const submitted = quantity;
					// #4448: ダイアログが閉じる前に出発点 (合計消費ポイントの数字) を掴む
					const flightOrigin = captureFlightOrigin(totalPointsEl);
					const balanceBefore = balance;
					return async ({ result, update }) => {
						isSubmitting = false;
						if (result.type === 'success') {
							// #4407 AC11: 成功時も form を更新し、前回のエラー表示を残さない。
							// #4407 AC9/AC12: 「何を何個 交換できたか」「残りポイント」を文字で出す。
							// prefers-reduced-motion で紙吹雪が無効化されても結果は必ず伝わる。
							const data = result.data as
								| { instant?: boolean; quantity?: number; balance?: number }
								| undefined;
							const qty = data?.quantity ?? submitted;
							const instant = data?.instant ?? false;
							showToast(
								instant
									? CHILD_SHOP_LABELS.exchangeSuccessToastTitle
									: CHILD_SHOP_LABELS.exchangeRequestedToastTitle,
								instant
									? CHILD_SHOP_LABELS.exchangeSuccessToastBody(
											rewardTitle,
											qty,
											data?.balance ?? remainingAfter,
										)
									: CHILD_SHOP_LABELS.exchangeRequestedToastBody(rewardTitle, qty),
								'success',
							);
							await update();
							onClose();
							void playRewardCelebration();
							// #4448: 減った分を `-N` (赤) でヘッダー残高へ飛ばし、減算後の値まで数える。
							// 親承認待ち (instant=false) は残高が動かないため、演出は自動的に出ない。
							await animateBalanceChange({
								balanceBefore,
								originRect: flightOrigin,
								settings: pointSettings,
								commit: () => invalidateAll(),
								readBalance: () => balance,
							});
						} else {
							// 失敗も同じ場所に出す (画面最上部の Alert はスクロール位置によっては見えない)。
							const message =
								(result.type === 'failure'
									? (result.data as { error?: string } | undefined)?.error
									: undefined) ?? CHILD_SHOP_LABELS.errorGeneric;
							showToast(message, undefined, 'error');
							await update();
							onClose();
						}
					};
				}}
				class="confirm-yes-form"
			>
				<input type="hidden" name="rewardId" value={rewardId} />
				<input type="hidden" name="quantity" value={quantity} />
				<div class="confirm-yes-pulse">
					<Button
						type="submit"
						variant="primary"
						size="lg"
						loading={isSubmitting}
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
