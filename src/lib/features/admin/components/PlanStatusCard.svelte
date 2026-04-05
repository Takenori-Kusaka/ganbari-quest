<script lang="ts">
import Card from '$lib/ui/primitives/Card.svelte';

interface Props {
	planTier: 'free' | 'standard' | 'family';
	activityCount?: number;
	activityMax?: number | null;
	childCount?: number;
	childMax?: number | null;
	retentionDays?: number | null;
}

let {
	planTier,
	activityCount = 0,
	activityMax = null,
	childCount = 0,
	childMax = null,
	retentionDays = null,
}: Props = $props();

const FREE_LABEL = { name: '無料プラン', icon: '' };
const planLabels: Record<string, { name: string; icon: string }> = {
	free: FREE_LABEL,
	standard: { name: 'スタンダード プラン', icon: '⭐' },
	family: { name: 'ファミリー プラン', icon: '⭐⭐' },
};

const label: { name: string; icon: string } = $derived(planLabels[planTier] ?? FREE_LABEL);
const retentionLabel = $derived(retentionDays === null ? '無制限' : `${retentionDays}日間`);
</script>

<Card class="plan-status-card plan-status-card--{planTier}">
	<div class="plan-status">
		<h3 class="plan-status__title">
			{#if label.icon}<span class="plan-status__icon">{label.icon}</span>{/if}
			{label.name}
		</h3>

		<div class="plan-status__stats">
			<div class="plan-status__stat">
				<span class="plan-status__stat-label">カスタム活動</span>
				<span class="plan-status__stat-value">
					{activityCount} / {activityMax === null ? '無制限' : activityMax}
				</span>
			</div>
			<div class="plan-status__stat">
				<span class="plan-status__stat-label">こども</span>
				<span class="plan-status__stat-value">
					{childCount} / {childMax === null ? '無制限' : childMax}
				</span>
			</div>
			<div class="plan-status__stat">
				<span class="plan-status__stat-label">データ保持</span>
				<span class="plan-status__stat-value">{retentionLabel}</span>
			</div>
		</div>

		{#if planTier === 'free'}
			<a href="/admin/license" class="plan-status__cta plan-status__cta--upgrade">
				⭐ プレミアムにアップグレード
			</a>
		{:else if planTier === 'standard'}
			<div class="plan-status__actions">
				<a href="/admin/license" class="plan-status__cta plan-status__cta--detail">プランの詳細</a>
				<a href="/admin/license" class="plan-status__cta plan-status__cta--family">⭐⭐ ファミリーへ</a>
			</div>
		{/if}
	</div>
</Card>

<style>
	.plan-status {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.plan-status__title {
		font-size: 0.95rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	:global(.plan-status-card--free) .plan-status__title {
		color: var(--color-text-secondary);
	}
	:global(.plan-status-card--standard) .plan-status__title {
		color: var(--color-premium);
	}
	:global(.plan-status-card--family) .plan-status__title {
		color: var(--color-gold-700, var(--color-amber-700));
	}
	:global(.plan-status-card--standard) {
		border-color: var(--color-premium-bg);
		background: linear-gradient(135deg, var(--color-premium-bg), var(--color-surface-card));
	}
	:global(.plan-status-card--family) {
		border-color: var(--color-gold-200, var(--color-amber-200));
		background: linear-gradient(135deg, var(--color-gold-50, var(--color-amber-50)), var(--color-surface-card));
	}
	.plan-status__stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}
	.plan-status__stat {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.plan-status__stat-label {
		font-size: 0.7rem;
		color: var(--color-text-tertiary);
	}
	.plan-status__stat-value {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}
	.plan-status__cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-md);
		font-size: 0.8rem;
		font-weight: 700;
		text-decoration: none;
		transition: all 0.15s;
	}
	.plan-status__cta--upgrade {
		background: linear-gradient(135deg, var(--color-premium), var(--color-premium-light));
		color: white;
	}
	.plan-status__cta--upgrade:hover {
		opacity: 0.9;
	}
	.plan-status__actions {
		display: flex;
		gap: 0.5rem;
	}
	.plan-status__cta--detail {
		background: var(--color-surface-secondary);
		color: var(--color-text-secondary);
		flex: 1;
	}
	.plan-status__cta--detail:hover {
		background: var(--color-neutral-200);
	}
	.plan-status__cta--family {
		background: var(--color-gold-100, #fef3c7);
		color: var(--color-gold-700, var(--color-amber-700));
		flex: 1;
	}
	.plan-status__cta--family:hover {
		background: var(--color-gold-200, var(--color-amber-200));
	}
</style>
