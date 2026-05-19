<script lang="ts">
// /admin/rewards/requests — ごほうび申請承認画面 (#2269)
//
// 子#2 (#2268) で /admin/rewards から申請タブ表示を削除。
// 本画面で承認/却下フローを専用 URL に分離 (CRUD と承認フローの責務分離)。

import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import {
	ADMIN_REWARDS_REQUESTS_LABELS,
	ADMIN_SHOP_REQUEST_LABELS,
	APP_LABELS,
} from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();

const redemptionError = $derived(
	(form as Record<string, unknown> | null)?.redemptionError as string | undefined,
);

let rejectingRequestId = $state<number | null>(null);
let rejectNote = $state('');

function openRejectForm(id: number) {
	rejectingRequestId = id;
	rejectNote = '';
}

function closeRejectForm() {
	rejectingRequestId = null;
	rejectNote = '';
}
</script>

<svelte:head>
	<title>{ADMIN_REWARDS_REQUESTS_LABELS.pageTitle}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-4" data-tutorial="rewards-requests-section">
	<div class="flex items-center gap-2">
		<h2 class="text-lg font-bold">{ADMIN_REWARDS_REQUESTS_LABELS.pageDescTitle}</h2>
		<a href="/admin/rewards" class="ml-auto text-sm text-[var(--color-text-link)] hover:underline" data-testid="back-to-rewards">
			{ADMIN_REWARDS_REQUESTS_LABELS.backToRewardsLabel}
		</a>
	</div>

	<div class="page-description">
		<p class="page-description__text">{ADMIN_REWARDS_REQUESTS_LABELS.pageDescText}</p>
	</div>

	{#if redemptionError}
		<Alert variant="danger" message={redemptionError} />
	{/if}

	<!-- 未処理の申請 -->
	<section>
		<div class="flex items-baseline gap-2 mb-2">
			<h3 class="text-sm font-bold text-[var(--color-text-muted)]">{ADMIN_REWARDS_REQUESTS_LABELS.pendingSectionTitle}</h3>
			<span class="text-xs text-[var(--color-text-tertiary)]">
				{ADMIN_REWARDS_REQUESTS_LABELS.pendingCountSuffix(data.pendingRequests.length)}
			</span>
		</div>
		{#if data.pendingRequests.length === 0}
			<Alert variant="info" message={ADMIN_REWARDS_REQUESTS_LABELS.emptyPendingMessage} />
		{:else}
			<div class="space-y-3">
				{#each data.pendingRequests as req (req.id)}
					<Card variant="elevated" padding="md">
						{#snippet children()}
						<div class="request-card">
							<span class="request-icon" aria-hidden="true">{req.rewardIcon ?? '🎁'}</span>
							<div class="request-info">
								<p class="request-title">{req.rewardTitle}</p>
								<p class="request-meta">
									{req.childName} ·
									{req.rewardPoints}{ADMIN_REWARDS_REQUESTS_LABELS.rewardPointsUnit}
								</p>
								<p class="request-date">
									{ADMIN_REWARDS_REQUESTS_LABELS.requestedAtLabel}:
									{new Date(req.requestedAt * 1000).toLocaleDateString('ja-JP')}
								</p>
							</div>
							<div class="request-actions">
								{#if rejectingRequestId === req.id}
									<form
										method="POST"
										action="?/rejectRedemption"
										use:enhance={() => {
											return async ({ update }) => {
												closeRejectForm();
												await update();
											};
										}}
										class="reject-form"
									>
										<input type="hidden" name="requestId" value={req.id} />
										<FormField
											label={ADMIN_REWARDS_REQUESTS_LABELS.rejectNoteLabel}
											type="textarea"
											name="parentNote"
											bind:value={rejectNote}
										/>
										<div class="reject-form-actions">
											<Button type="submit" variant="danger" size="sm">
												{ADMIN_REWARDS_REQUESTS_LABELS.rejectConfirmButton}
											</Button>
											<Button type="button" variant="ghost" size="sm" onclick={closeRejectForm}>
												{ADMIN_REWARDS_REQUESTS_LABELS.rejectCancelButton}
											</Button>
										</div>
									</form>
								{:else}
									<form
										method="POST"
										action="?/approveRedemption"
										use:enhance={() => {
											return async ({ update }) => {
												await invalidateAll();
												await update();
											};
										}}
									>
										<input type="hidden" name="requestId" value={req.id} />
										<Button type="submit" variant="success" size="sm" data-testid="approve-btn-{req.id}">
											{ADMIN_REWARDS_REQUESTS_LABELS.approveButton}
										</Button>
									</form>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onclick={() => openRejectForm(req.id)}
										data-testid="reject-btn-{req.id}"
									>
										{ADMIN_REWARDS_REQUESTS_LABELS.rejectButton}
									</Button>
								{/if}
							</div>
						</div>
						{/snippet}
					</Card>
				{/each}
			</div>
		{/if}
	</section>

	<!-- 履歴 -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{ADMIN_REWARDS_REQUESTS_LABELS.historySectionTitle}</h3>
		{#if data.historyRequests.length === 0}
			<Alert variant="info" message={ADMIN_REWARDS_REQUESTS_LABELS.emptyHistoryMessage} />
		{:else}
			<div class="space-y-2">
				{#each data.historyRequests as req (req.id)}
					<div class="history-item">
						<span class="history-icon" aria-hidden="true">{req.rewardIcon ?? '🎁'}</span>
						<div class="history-info">
							<p class="history-title">{req.rewardTitle}</p>
							<p class="history-meta">{req.childName} · {req.rewardPoints}{ADMIN_SHOP_REQUEST_LABELS.rewardPointsUnit}</p>
						</div>
						<span class="history-status {req.status === 'approved' ? 'history-status--approved' : 'history-status--rejected'}">
							{req.status === 'approved' ? ADMIN_REWARDS_REQUESTS_LABELS.statusApproved : ADMIN_REWARDS_REQUESTS_LABELS.statusRejected}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.page-description {
		background: var(--color-surface-card);
		border-radius: 0.75rem;
		padding: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}
	.page-description__text {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}

	.request-card {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.request-icon {
		font-size: 2rem;
		line-height: 1;
		flex-shrink: 0;
	}
	.request-info {
		flex: 1;
		min-width: 0;
	}
	.request-title {
		font-weight: 700;
		font-size: 0.9375rem;
		margin: 0;
	}
	.request-meta {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin: 0.125rem 0 0;
	}
	.request-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0.125rem 0 0;
	}
	.request-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex-shrink: 0;
		align-items: flex-end;
	}
	.reject-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}
	.reject-form-actions {
		display: flex;
		gap: 0.5rem;
	}

	.history-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-surface-card);
		border-radius: 0.75rem;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}
	.history-icon {
		font-size: 1.5rem;
		line-height: 1;
		flex-shrink: 0;
	}
	.history-info {
		flex: 1;
		min-width: 0;
	}
	.history-title {
		font-weight: 600;
		font-size: 0.875rem;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.history-meta {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
	}
	.history-status {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		flex-shrink: 0;
	}
	.history-status--approved {
		background: var(--color-surface-success);
		color: var(--color-feedback-success-text);
	}
	.history-status--rejected {
		background: var(--color-surface-muted);
		color: var(--color-text-muted);
	}
</style>
