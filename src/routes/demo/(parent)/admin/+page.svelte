<script lang="ts">
import AdminHome from '$lib/features/admin/components/AdminHome.svelte';
import PlanStatusCard from '$lib/features/admin/components/PlanStatusCard.svelte';

let { data } = $props();

const planTier = $derived(data.planTier ?? 'standard');
const planStats = $derived(data.planStats);
</script>

<div class="demo-admin-plan space-y-4">
	<!-- プラン切替トグル (#791, #760): デモ用にクエリパラメータで全プランを体験できる -->
	<div class="plan-switcher" role="group" aria-label="デモ用プラン切替">
		<span class="plan-switcher__label">デモ: プランを切り替えて体験</span>
		<div class="plan-switcher__buttons">
			<a
				href="/demo/admin?plan=free"
				class="plan-switcher__button"
				class:plan-switcher__button--active={planTier === 'free'}
				data-testid="demo-plan-switch-free"
			>
				無料プラン
			</a>
			<a
				href="/demo/admin?plan=standard"
				class="plan-switcher__button"
				class:plan-switcher__button--active={planTier === 'standard'}
				data-testid="demo-plan-switch-standard"
			>
				⭐ スタンダード
			</a>
			<a
				href="/demo/admin?plan=family"
				class="plan-switcher__button"
				class:plan-switcher__button--active={planTier === 'family'}
				data-testid="demo-plan-switch-family"
			>
				⭐⭐ ファミリー
			</a>
		</div>
	</div>

	{#if planStats}
		<PlanStatusCard
			{planTier}
			activityCount={planStats.activityCount}
			activityMax={planStats.activityMax}
			childCount={planStats.childCount}
			childMax={planStats.childMax}
			retentionDays={planStats.retentionDays}
		/>
	{/if}

	<!-- デモでは実際のトライアル状態が無いため、free プランの時のみ CTA を表示 (#731 TrialBanner の "not-started" ステートと同等) -->
	{#if planTier === 'free'}
		<div class="demo-trial-cta" data-testid="demo-trial-cta">
			<div class="demo-trial-cta__icon">🎁</div>
			<div class="demo-trial-cta__content">
				<p class="demo-trial-cta__title">7日間の無料体験</p>
				<p class="demo-trial-cta__desc">
					スタンダードプランの全機能を7日間無料で体験できます。
				</p>
			</div>
			<a href="/demo/admin/license" class="demo-trial-cta__button">
				プランを見る
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
