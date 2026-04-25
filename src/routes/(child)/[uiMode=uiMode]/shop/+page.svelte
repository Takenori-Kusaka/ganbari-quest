<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { APP_LABELS, CHILD_SHOP_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data, form } = $props();

// 交換確認 Dialog の状態
let confirmDialogOpen = $state(false);
let selectedRewardId = $state<number | null>(null);
let selectedRewardTitle = $state('');
let selectedRewardPoints = $state(0);
let isSubmitting = $state(false);

function openConfirmDialog(id: number, title: string, points: number) {
	selectedRewardId = id;
	selectedRewardTitle = title;
	selectedRewardPoints = points;
	confirmDialogOpen = true;
}

function closeConfirmDialog() {
	confirmDialogOpen = false;
	selectedRewardId = null;
}

const pageTitle = $derived(`${CHILD_SHOP_LABELS.pageTitle}${APP_LABELS.pageTitleSuffix}`);
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="shop-page" data-testid="shop-page">
	<!-- ポイント残高バナー -->
	<div class="balance-banner">
		<span class="balance-label">{CHILD_SHOP_LABELS.pointBalanceLabel}</span>
		<span class="balance-value" data-testid="point-balance">
			{data.balance}
			<span class="balance-unit">{CHILD_SHOP_LABELS.pointUnit}</span>
		</span>
	</div>

	{#if form?.error}
		<Alert variant="danger" message={form.error} />
	{/if}

	<!-- ごほうびリスト -->
	{#if data.rewards.length === 0}
		<div class="empty-state">
			<Alert variant="info" message={CHILD_SHOP_LABELS.emptyMessage} />
		</div>
	{:else}
		<ul class="reward-list" aria-label="ごほうびリスト">
			{#each data.rewards as reward (reward.id)}
				{@const canExchange =
					data.balance >= reward.points && reward.latestRequestStatus !== 'pending_parent_approval'}
				{@const remaining = reward.points - data.balance}

				<li>
					<Card>
						<div class="reward-card" data-testid="reward-card-{reward.id}">
							<!-- アイコンと名前 -->
							<div class="reward-icon-wrap">
								<span class="reward-icon" aria-hidden="true">{reward.icon ?? '🎁'}</span>
							</div>
							<div class="reward-info">
								<p class="reward-title">{reward.title}</p>
								<p class="reward-points">
									<span class="reward-points-num">{reward.points}</span>
									<span class="reward-points-unit">{CHILD_SHOP_LABELS.pointUnit}</span>
								</p>

								<!-- 申請状態バッジ -->
								{#if reward.latestRequestStatus === 'pending_parent_approval'}
									<Badge variant="warning">{CHILD_SHOP_LABELS.statusPending}</Badge>
								{:else if reward.latestRequestStatus === 'approved'}
									<Badge variant="success">{CHILD_SHOP_LABELS.statusApproved}</Badge>
								{:else if reward.latestRequestStatus === 'rejected'}
									<Badge variant="neutral">{CHILD_SHOP_LABELS.statusRejected}</Badge>
								{/if}

								<!-- ポイント不足プログレスバー -->
								{#if data.balance < reward.points && reward.latestRequestStatus !== 'pending_parent_approval'}
									<div class="progress-wrap" aria-label="ポイント進捗">
										<progress
											max={reward.points}
											value={data.balance}
											class="progress-bar"
										></progress>
										<span class="progress-hint">
											{CHILD_SHOP_LABELS.insufficientPointsHint(remaining)}
										</span>
									</div>
								{/if}
							</div>

							<!-- 交換ボタン -->
							{#if reward.latestRequestStatus !== 'pending_parent_approval'}
								<div class="reward-action">
									<Button
										variant={canExchange ? 'primary' : 'ghost'}
										disabled={!canExchange}
										onclick={() => openConfirmDialog(reward.id, reward.title, reward.points)}
										data-testid="exchange-btn-{reward.id}"
									>
										{CHILD_SHOP_LABELS.exchangeButton}
									</Button>
								</div>
							{/if}
						</div>
					</Card>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- 交換確認 Dialog -->
<Dialog bind:open={confirmDialogOpen} title="">
	<div class="confirm-dialog-body">
		<p class="confirm-message">
			{CHILD_SHOP_LABELS.exchangeConfirmTitle(selectedRewardTitle, selectedRewardPoints)}
		</p>
		<div class="confirm-actions">
			<form
				method="POST"
				action="?/requestExchange"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ result, update }) => {
						isSubmitting = false;
						if (result.type === 'success' || result.type === 'redirect') {
							closeConfirmDialog();
							await invalidateAll();
						} else {
							await update();
							closeConfirmDialog();
						}
					};
				}}
			>
				<input type="hidden" name="rewardId" value={selectedRewardId} />
				<Button
					type="submit"
					variant="primary"
					disabled={isSubmitting}
					data-testid="confirm-exchange-yes"
				>
					{CHILD_SHOP_LABELS.exchangeConfirmYes}
				</Button>
			</form>
			<Button
				variant="ghost"
				onclick={closeConfirmDialog}
				data-testid="confirm-exchange-cancel"
			>
				{CHILD_SHOP_LABELS.exchangeConfirmCancel}
			</Button>
		</div>
	</div>
</Dialog>

<style>
	.shop-page {
		padding: var(--sp-md);
		max-width: 480px;
		margin: 0 auto;
	}

	.balance-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background-color: var(--color-surface-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--sp-md) var(--sp-lg);
		margin-bottom: var(--sp-md);
		gap: var(--sp-sm);
	}

	.balance-label {
		font-size: 0.9rem;
		color: var(--color-text-secondary);
	}

	.balance-value {
		font-size: 1.5rem;
		font-weight: bold;
		color: var(--color-point, gold);
	}

	.balance-unit {
		font-size: 0.85rem;
		font-weight: normal;
		margin-left: 2px;
	}

	.empty-state {
		margin-top: var(--sp-md);
	}

	.reward-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--sp-sm);
	}

	.reward-card {
		display: flex;
		align-items: center;
		gap: var(--sp-sm);
	}

	.reward-icon-wrap {
		flex-shrink: 0;
	}

	.reward-icon {
		font-size: 2.5rem;
		line-height: 1;
	}

	.reward-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.reward-title {
		font-weight: bold;
		font-size: 1rem;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.reward-points {
		font-size: 0.9rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.reward-points-num {
		font-weight: bold;
		color: var(--color-point, gold);
	}

	.reward-points-unit {
		font-size: 0.8rem;
	}

	.progress-wrap {
		margin-top: 4px;
	}

	.progress-bar {
		width: 100%;
		height: 6px;
		border-radius: 3px;
		appearance: none;
		background-color: var(--color-surface-secondary);
	}

	.progress-bar::-webkit-progress-bar {
		background-color: var(--color-surface-secondary);
		border-radius: 3px;
	}

	.progress-bar::-webkit-progress-value {
		background-color: var(--color-action-primary);
		border-radius: 3px;
	}

	.progress-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.reward-action {
		flex-shrink: 0;
	}

	.confirm-dialog-body {
		display: flex;
		flex-direction: column;
		gap: var(--sp-md);
		align-items: center;
		text-align: center;
		padding: var(--sp-md) 0;
	}

	.confirm-message {
		font-size: 1rem;
		font-weight: bold;
		margin: 0;
	}

	.confirm-actions {
		display: flex;
		gap: var(--sp-sm);
		width: 100%;
		justify-content: center;
	}
</style>
