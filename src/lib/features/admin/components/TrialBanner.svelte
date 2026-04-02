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
		border: 1px solid var(--color-violet-200, #ddd6fe);
		border-radius: 12px;
		background: linear-gradient(135deg, var(--color-violet-50, #f5f3ff), var(--color-blue-50, #eff6ff));
	}

	.trial-banner.urgent {
		border-color: var(--color-amber-300, #fcd34d);
		background: linear-gradient(135deg, var(--color-amber-50, #fffbeb), var(--color-orange-50, #fff7ed));
	}

	.trial-banner.expired {
		border-color: var(--color-neutral-200, #e5e7eb);
		background: var(--color-neutral-50, #f9fafb);
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
		color: var(--color-neutral-700, #374151);
		margin: 0;
	}

	.trial-desc {
		font-size: 0.75rem;
		color: var(--color-neutral-500, #6b7280);
		margin: 4px 0 0;
	}

	.trial-cta {
		flex-shrink: 0;
		padding: 6px 12px;
		background: var(--color-violet-500, #8b5cf6);
		color: white;
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 8px;
		text-decoration: none;
		transition: background 0.15s;
	}

	.trial-cta:hover {
		background: var(--color-violet-600, #7c3aed);
	}

	.trial-cta.upgrade {
		background: var(--color-amber-500, #f59e0b);
	}

	.trial-cta.upgrade:hover {
		background: var(--color-amber-600, #d97706);
	}
</style>
