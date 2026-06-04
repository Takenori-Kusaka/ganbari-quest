<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { TRIAL_LABELS } from '$lib/domain/labels';

interface Props {
	isTrialActive: boolean;
	daysRemaining: number;
	trialUsed: boolean;
	trialEndDate: string | null;
	planTier?: 'free' | 'standard' | 'family';
	hasArchivedResources?: boolean;
}

let {
	isTrialActive,
	daysRemaining,
	trialUsed,
	trialEndDate,
	planTier = 'free',
	hasArchivedResources = false,
}: Props = $props();

// 状態判定: #731 — 未使用 free ユーザーにもトライアル開始導線を表示
const isTrialExpired = $derived(trialUsed && !isTrialActive && trialEndDate !== null);
const canStartTrial = $derived(planTier === 'free' && !trialUsed && !isTrialActive);
const isUrgent = $derived(daysRemaining <= 1);

let submitting = $state(false);
</script>

{#if isTrialActive}
	<div class="trial-banner" class:urgent={isUrgent}>
		<div class="trial-icon">{isUrgent ? '⏰' : '⭐'}</div>
		<div class="trial-content">
			<p class="trial-title">
				{#if isUrgent}
					{TRIAL_LABELS.bannerTitleUrgent}
				{:else}
					{TRIAL_LABELS.bannerTitleActive(daysRemaining)}
				{/if}
			</p>
			<p class="trial-desc">{TRIAL_LABELS.bannerDescActive}</p>
		</div>
		<a href="/admin/subscription" class="trial-cta" data-testid="trial-banner-active-cta">
			{TRIAL_LABELS.bannerCtaNotStarted}
		</a>
	</div>
{:else if canStartTrial}
	<div class="trial-banner not-started" data-testid="trial-banner-not-started">
		<div class="trial-icon">🎁</div>
		<div class="trial-content">
			<p class="trial-title">{TRIAL_LABELS.bannerTitleNotStarted}</p>
			<p class="trial-desc">{TRIAL_LABELS.bannerDescNotStarted}</p>
			<!--
				#2901 AC2 (contextual paywall): 「全機能無料」だけでは「どの機能が無料版で
				使えないのか」をユーザーが recognition できない (PO 指摘 #4)。free 版で制限される
				主要機能を列挙し「やりたい事をやろうとしたら無料版では出来ない、に気づく」体験を作る。
			-->
			<div class="trial-gated" data-testid="trial-banner-gated-features">
				<p class="trial-gated-heading">{TRIAL_LABELS.bannerGatedHeading}</p>
				<ul class="trial-gated-list">
					{#each TRIAL_LABELS.bannerGatedFeatures as feature (feature)}
						<li class="trial-gated-item">{feature}</li>
					{/each}
				</ul>
			</div>
		</div>
		<form
			method="POST"
			action="/admin/subscription?/startTrial"
			use:enhance={() => {
				submitting = true;
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') {
						await invalidateAll();
					}
					submitting = false;
				};
			}}
		>
			<button
				type="submit"
				class="trial-cta"
				disabled={submitting}
				data-testid="trial-banner-start-button"
			>
				{submitting ? TRIAL_LABELS.bannerCtaSubmitting : TRIAL_LABELS.bannerCtaStart}
			</button>
		</form>
	</div>
{:else if isTrialExpired}
	<div class="trial-banner expired" data-testid="trial-banner-expired">
		<div class="trial-icon">📦</div>
		<div class="trial-content">
			<p class="trial-title">{TRIAL_LABELS.bannerTitleExpired}</p>
			{#if hasArchivedResources}
				<p class="trial-desc">{TRIAL_LABELS.bannerDescExpiredWithArchive}</p>
			{:else}
				<p class="trial-desc">{TRIAL_LABELS.bannerDescExpired}</p>
			{/if}
		</div>
		<a href="/admin/subscription" class="trial-cta upgrade" data-testid="trial-banner-expired-cta">
			{TRIAL_LABELS.bannerCtaExpired}
		</a>
	</div>
{/if}

<style>
	.trial-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border: 1px solid var(--color-border-trial);
		border-radius: 12px;
		background: var(--gradient-surface-trial);
	}

	.trial-banner.urgent {
		border-color: var(--color-border-trial-urgent);
		background: var(--gradient-surface-trial-urgent);
	}

	.trial-banner.not-started {
		border-color: var(--color-border-trial);
		background: var(--gradient-surface-trial);
	}

	.trial-banner.expired {
		border-color: var(--color-border-trial-expired);
		background: var(--color-surface-trial-expired);
	}

	.trial-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.trial-content {
		flex: 1;
	}

	.trial-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.trial-desc {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 4px 0 0;
	}

	/* #2901 AC2: contextual paywall — free 版で制限される機能の列挙 */
	.trial-gated {
		margin-top: 8px;
	}

	.trial-gated-heading {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		margin: 0 0 4px;
	}

	.trial-gated-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 8px;
	}

	.trial-gated-item {
		font-size: 0.7rem;
		color: var(--color-text-primary);
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-trial);
		border-radius: 6px;
		padding: 2px 8px;
	}

	.trial-gated-item::before {
		content: '🔒';
		margin-right: 4px;
		font-size: 0.65rem;
	}

	.trial-cta {
		flex-shrink: 0;
		padding: 6px 12px;
		background: var(--color-action-trial);
		color: var(--color-text-inverse);
		font-size: 0.75rem;
		font-weight: 600;
		border: none;
		border-radius: 8px;
		text-decoration: none;
		cursor: pointer;
		transition: background 0.15s;
	}

	.trial-cta:hover:not(:disabled) {
		background: var(--color-action-trial-hover);
	}

	.trial-cta:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.trial-cta.upgrade {
		background: var(--color-action-trial-upgrade);
	}

	.trial-cta.upgrade:hover {
		background: var(--color-action-trial-upgrade-hover);
	}

	form {
		margin: 0;
	}
</style>
