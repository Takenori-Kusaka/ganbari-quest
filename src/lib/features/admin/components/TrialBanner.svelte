<script lang="ts">
import { TRIAL_LABELS } from '$lib/domain/labels';

// #3033 (PO 指摘 2026-06-12): TrialBanner は urgent (trial 残 1 日以下) 専用。
// - not-started (開始導線 + 制限機能列挙) は全ページ常設がモバイルで画面の半分を占め、
//   無料版のまま使い続けるユーザーの不利益になるため撤去。開始導線は /admin/subscription
//   (SaasLicensePanel) に一本化し、「何ができるか」はロック機能接触時の文脈表示
//   (FeatureGate / AiSuggestPanel 等) が担う
// - expired は一回限りの TrialEndedDialog (#770) + subscription ページ表示が代替
// - active (非 urgent) は header 残日数 pill (AdminLayout) が代替
interface Props {
	isTrialActive: boolean;
	daysRemaining: number;
}

let { isTrialActive, daysRemaining }: Props = $props();

const isUrgent = $derived(isTrialActive && daysRemaining <= 1);
</script>

{#if isUrgent}
	<div class="trial-banner urgent" data-testid="trial-banner-urgent">
		<div class="trial-icon">⏰</div>
		<div class="trial-content">
			<p class="trial-title">{TRIAL_LABELS.bannerTitleUrgent}</p>
			<p class="trial-desc">{TRIAL_LABELS.bannerDescActive}</p>
		</div>
		<a href="/admin/subscription" class="trial-cta" data-testid="trial-banner-active-cta">
			{TRIAL_LABELS.bannerCtaNotStarted}
		</a>
	</div>
{/if}

<style>
	.trial-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border-radius: 12px;
	}

	.trial-banner.urgent {
		border: 1px solid var(--color-border-trial-urgent);
		background: var(--gradient-surface-trial-urgent);
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

	.trial-cta:hover {
		background: var(--color-action-trial-hover);
	}
</style>
