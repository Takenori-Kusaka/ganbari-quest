<script lang="ts">
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

interface TrialStatusProp {
	isTrialActive: boolean;
	trialUsed: boolean;
	daysRemaining: number;
	trialEndDate: string | null;
	trialTier?: 'standard' | 'family' | null;
}

interface Props {
	planTier: 'free' | 'standard' | 'family';
	activityCount?: number;
	activityMax?: number | null;
	childCount?: number;
	childMax?: number | null;
	retentionDays?: number | null;
	/** #730: トライアル中は plan が standard/family に解決済みでも trial 文脈を表示する */
	trialStatus?: TrialStatusProp | null;
	/** #767: ワンクリックアップグレード — planId を受け取って Stripe Checkout を開始する */
	onUpgrade?: ((planId: string) => void) | null;
	/** #767: Checkout 処理中フラグ */
	upgradeLoading?: boolean;
	/** リンクのベースパス (デモ用) */
	basePath?: string;
}

let {
	planTier,
	activityCount = 0,
	activityMax = null,
	childCount = 0,
	childMax = null,
	retentionDays = null,
	trialStatus = null,
	onUpgrade = null,
	upgradeLoading = false,
	basePath = '/admin',
}: Props = $props();

const FREE_LABEL = { name: '無料プラン', icon: '' };
const planLabels: Record<string, { name: string; icon: string }> = {
	free: FREE_LABEL,
	standard: { name: 'スタンダード プラン', icon: '⭐' },
	family: { name: 'ファミリー プラン', icon: '⭐⭐' },
};

const label: { name: string; icon: string } = $derived(planLabels[planTier] ?? FREE_LABEL);
const retentionLabel = $derived(retentionDays === null ? '無制限' : `${retentionDays}日間`);

// #730: free + トライアル中 のケース
const isOnTrial = $derived(trialStatus?.isTrialActive === true);
const trialDaysRemaining = $derived(trialStatus?.daysRemaining ?? 0);
const trialTierLabel = $derived(
	trialStatus?.trialTier
		? (planLabels[trialStatus.trialTier]?.name ?? 'スタンダード プラン')
		: 'スタンダード プラン',
);
</script>

<Card class="plan-status-card plan-status-card--{planTier}">
	<div class="plan-status" data-testid="plan-status-card" data-plan-tier={planTier}>
		<h3 class="plan-status__title">
			{#if label.icon}<span class="plan-status__icon">{label.icon}</span>{/if}
			{label.name}
			{#if isOnTrial}
				<span class="plan-status__trial-badge" data-testid="plan-status-trial-badge">
					トライアル中（残り{trialDaysRemaining}日）
				</span>
			{/if}
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

		{#if isOnTrial}
			<p class="plan-status__trial-note" data-testid="plan-status-trial-note">
				{trialTierLabel}の全機能を体験中です。トライアル終了後もこのまま使うには本契約が必要です。
			</p>
			{#if onUpgrade}
				<Button
					variant="primary"
					size="md"
					class="plan-status__cta--upgrade-btn"
					disabled={upgradeLoading}
					data-testid="plan-status-trial-cta"
					onclick={() => onUpgrade?.('monthly')}
				>
					{upgradeLoading ? '処理中...' : '本契約する'}
				</Button>
			{:else}
				<a
					href="{basePath}/license"
					class="plan-status__cta plan-status__cta--upgrade"
					data-testid="plan-status-trial-cta"
				>
					本契約する
				</a>
			{/if}
		{:else if planTier === 'free'}
			{#if onUpgrade}
				<Button
					variant="primary"
					size="md"
					class="plan-status__cta--upgrade-btn"
					disabled={upgradeLoading}
					data-testid="plan-status-free-cta"
					onclick={() => onUpgrade?.('monthly')}
				>
					{upgradeLoading ? '処理中...' : '⭐ スタンダードにアップグレード'}
				</Button>
			{:else}
				<a
					href="{basePath}/license"
					class="plan-status__cta plan-status__cta--upgrade"
					data-testid="plan-status-free-cta"
				>
					⭐ スタンダードにアップグレード
				</a>
			{/if}
		{:else if planTier === 'standard'}
			<div class="plan-status__actions">
				<a href="{basePath}/license" class="plan-status__cta plan-status__cta--detail">プランの詳細</a>
				{#if onUpgrade}
					<Button
						variant="primary"
						size="sm"
						class="plan-status__cta--family-btn"
						disabled={upgradeLoading}
						data-testid="plan-status-family-cta"
						onclick={() => onUpgrade?.('family-monthly')}
					>
						{upgradeLoading ? '処理中...' : '⭐⭐ ファミリーへ'}
					</Button>
				{:else}
					<a href="{basePath}/license" class="plan-status__cta plan-status__cta--family">⭐⭐ ファミリーへ</a>
				{/if}
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
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.plan-status__trial-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--color-premium-bg);
		color: var(--color-premium);
		border: 1px solid var(--color-border-premium);
	}
	.plan-status__trial-note {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 0;
		line-height: 1.4;
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
		background: var(--color-gold-100, var(--color-surface-warm));
		color: var(--color-gold-700, var(--color-amber-700));
		flex: 1;
	}
	.plan-status__cta--family:hover {
		background: var(--color-gold-200, var(--color-amber-200));
	}
</style>
