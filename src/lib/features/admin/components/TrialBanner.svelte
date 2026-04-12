<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';

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
					無料体験は明日で終了します
				{:else}
					無料体験中（残り{daysRemaining}日）
				{/if}
			</p>
			<p class="trial-desc">全機能をお試しいただけます。</p>
		</div>
		<a href="/admin/license" class="trial-cta" data-testid="trial-banner-active-cta">
			プランを見る
		</a>
	</div>
{:else if canStartTrial}
	<div class="trial-banner not-started" data-testid="trial-banner-not-started">
		<div class="trial-icon">🎁</div>
		<div class="trial-content">
			<p class="trial-title">7日間、全機能を無料で試せます</p>
			<p class="trial-desc">スタンダードプランのすべての機能をお使いいただけます。カード登録不要。</p>
		</div>
		<form
			method="POST"
			action="/admin/license?/startTrial"
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
				{submitting ? '開始中...' : '7日間 無料で試す'}
			</button>
		</form>
	</div>
{:else if isTrialExpired}
	<div class="trial-banner expired" data-testid="trial-banner-expired">
		<div class="trial-icon">📦</div>
		<div class="trial-content">
			<p class="trial-title">無料体験が終了しました</p>
			{#if hasArchivedResources}
				<p class="trial-desc">一部のデータが制限されています。アップグレードですべて復元できます。</p>
			{:else}
				<p class="trial-desc">アップグレードで全機能をご利用いただけます。</p>
			{/if}
		</div>
		<a href="/admin/license" class="trial-cta upgrade" data-testid="trial-banner-expired-cta">
			⭐ アップグレード
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
