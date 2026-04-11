<script lang="ts">
interface Props {
	isTrialActive: boolean;
	daysRemaining: number;
	trialUsed: boolean;
	trialEndDate: string | null;
}

let { isTrialActive, daysRemaining, trialUsed, trialEndDate }: Props = $props();

const isTrialExpired = $derived(trialUsed && !isTrialActive && trialEndDate !== null);
const isUrgent = $derived(daysRemaining <= 1);
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
		<a href="/admin/license" class="trial-cta">
			プランを見る
		</a>
	</div>
{:else if isTrialExpired}
	<div class="trial-banner expired">
		<div class="trial-icon">📦</div>
		<div class="trial-content">
			<p class="trial-title">無料体験が終了しました</p>
			<p class="trial-desc">カスタムデータはアップグレードで復活します。</p>
		</div>
		<a href="/admin/license" class="trial-cta upgrade">
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
		border-radius: 8px;
		text-decoration: none;
		transition: background 0.15s;
	}

	.trial-cta:hover {
		background: var(--color-action-trial-hover);
	}

	.trial-cta.upgrade {
		background: var(--color-action-trial-upgrade);
	}

	.trial-cta.upgrade:hover {
		background: var(--color-action-trial-upgrade-hover);
	}
</style>
