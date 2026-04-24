<script lang="ts">
import { DEMO_ADMIN_HOME_LABELS, getPlanLabel } from '$lib/domain/labels';
import AdminHome from '$lib/features/admin/components/AdminHome.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const planTier = $derived(data.planTier ?? 'standard');
const planStats = $derived(data.planStats);
const retentionLabel = $derived(
	planStats?.retentionDays === null ? '無制限' : `${planStats?.retentionDays}日間`,
);
</script>

<div class="demo-admin-plan space-y-4">
	<!-- プラン切替トグル (#791, #760): デモ用にクエリパラメータで全プランを体験できる -->
	<div class="plan-switcher" role="group" aria-label={DEMO_ADMIN_HOME_LABELS.planSwitcherAriaLabel}>
		<span class="plan-switcher__label">{DEMO_ADMIN_HOME_LABELS.planSwitcherLabel}</span>
		<div class="plan-switcher__buttons">
			<a
				href="/demo/admin?plan=free"
				class="plan-switcher__button"
				class:plan-switcher__button--active={planTier === 'free'}
				data-testid="demo-plan-switch-free"
			>
				{DEMO_ADMIN_HOME_LABELS.freePlanButton}
			</a>
			<a
				href="/demo/admin?plan=standard"
				class="plan-switcher__button"
				class:plan-switcher__button--active={planTier === 'standard'}
				data-testid="demo-plan-switch-standard"
			>
				{DEMO_ADMIN_HOME_LABELS.standardPlanButton}
			</a>
			<a
				href="/demo/admin?plan=family"
				class="plan-switcher__button"
				class:plan-switcher__button--active={planTier === 'family'}
				data-testid="demo-plan-switch-family"
			>
				{DEMO_ADMIN_HOME_LABELS.familyPlanButton}
			</a>
		</div>
	</div>

	<!-- プラン利用状況（デモ版: PlanStatusCard は CTA が /admin/license にハードコードされているため使わない — PR #854 と同じ対応） -->
	{#if planStats}
		<Card variant="default" padding="lg">
			{#snippet children()}
				<h3 class="plan-stats__title">{getPlanLabel(planTier)}</h3>
				<div class="plan-stats__grid">
					<div class="plan-stats__item">
						<span class="plan-stats__label">{DEMO_ADMIN_HOME_LABELS.statsActivityLabel}</span>
						<span class="plan-stats__value">
							{planStats.activityCount} / {planStats.activityMax === null ? '無制限' : planStats.activityMax}
						</span>
					</div>
					<div class="plan-stats__item">
						<span class="plan-stats__label">{DEMO_ADMIN_HOME_LABELS.statsChildLabel}</span>
						<span class="plan-stats__value">
							{planStats.childCount} / {planStats.childMax === null ? '無制限' : planStats.childMax}
						</span>
					</div>
					<div class="plan-stats__item">
						<span class="plan-stats__label">{DEMO_ADMIN_HOME_LABELS.statsRetentionLabel}</span>
						<span class="plan-stats__value">{retentionLabel}</span>
					</div>
				</div>
			{/snippet}
		</Card>
	{/if}

	<!-- デモでは実際のトライアル状態が無いため、free プランの時のみ CTA を表示 (#731 TrialBanner の "not-started" ステートと同等) -->
	{#if planTier === 'free'}
		<div class="demo-trial-cta" data-testid="demo-trial-cta">
			<div class="demo-trial-cta__icon">🎁</div>
			<div class="demo-trial-cta__content">
				<p class="demo-trial-cta__title">{DEMO_ADMIN_HOME_LABELS.trialCtaTitle}</p>
				<p class="demo-trial-cta__desc">
					{DEMO_ADMIN_HOME_LABELS.trialCtaDesc}
				</p>
			</div>
			<a href="/demo/admin/license" class="demo-trial-cta__button">
				{DEMO_ADMIN_HOME_LABELS.trialCtaButton}
			</a>
		</div>
	{/if}
</div>

<AdminHome
	children={data.children}
	pointSettings={data.pointSettings}
	mode="demo"
	basePath="/demo/admin"
	planTier={planTier}
/>

<style>
	.demo-admin-plan {
		margin-bottom: 1.5rem;
	}

	.plan-switcher {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--color-surface-muted);
		border-radius: var(--radius-md, 8px);
		border: 1px dashed var(--color-border-default);
	}

	.plan-switcher__label {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-tertiary);
	}

	.plan-switcher__buttons {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.plan-switcher__button {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md, 8px);
		text-align: center;
		font-size: 0.75rem;
		font-weight: 600;
		text-decoration: none;
		color: var(--color-text-secondary);
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
		transition: all 0.15s;
	}

	.plan-switcher__button:hover {
		border-color: var(--color-border-focus);
	}

	.plan-switcher__button--active {
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
		border-color: var(--color-action-primary);
	}

	.plan-stats__title {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0 0 0.75rem;
	}

	.plan-stats__grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
	}

	.plan-stats__item {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.plan-stats__label {
		font-size: 0.7rem;
		color: var(--color-text-tertiary);
	}

	.plan-stats__value {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.demo-trial-cta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: var(--color-feedback-info-bg);
		border: 1px solid var(--color-feedback-info-border);
		border-radius: var(--radius-lg, 12px);
	}

	.demo-trial-cta__icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.demo-trial-cta__content {
		flex: 1;
		min-width: 0;
	}

	.demo-trial-cta__title {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-feedback-info-text);
		margin: 0;
	}

	.demo-trial-cta__desc {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		margin: 0.125rem 0 0;
	}

	.demo-trial-cta__button {
		flex-shrink: 0;
		padding: 0.5rem 0.875rem;
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
		font-size: 0.75rem;
		font-weight: 700;
		border-radius: var(--radius-md, 8px);
		text-decoration: none;
		white-space: nowrap;
	}
</style>
