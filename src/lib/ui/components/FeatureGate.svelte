<script lang="ts">
import type { Snippet } from 'svelte';
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
import { PLAN_TERMS } from '$lib/domain/terms';
import { meetsRequiredTier, type PlanTier } from '$lib/ui/tutorial/tutorial-types';
import PremiumBadge from './PremiumBadge.svelte';

interface Props {
	/** 現在のプラン */
	currentTier: PlanTier;
	/** この機能に必要な最低プラン */
	requiredTier: PlanTier;
	/** 有料機能へのコンテンツ */
	children: Snippet;
	/** ロック時の代替表示 (省略時はデフォルトのロック表示) */
	locked?: Snippet;
	/** disabled ボタンとして表示する場合のラベル */
	buttonLabel?: string;
	/** インライン表示（ボタン用）か、セクション表示か */
	display?: 'inline' | 'section';
}

let {
	currentTier,
	requiredTier,
	children,
	locked,
	buttonLabel,
	display = 'section',
}: Props = $props();

// Phase 7 PR-L4 (#2836): 顧客可視の gate ラベルを premium atom 参照化 (ADR-0045 / ADR-0058)。
const TIER_LABELS: Record<PlanTier, string> = {
	free: PLAN_TERMS.free,
	standard: PLAN_TERMS.standard,
	family: PLAN_TERMS.premium,
};

// requiredTier を満たさない = ロック。tutorial-chapters / page-guide と同じ TIER_ORDER SSOT を共有する。
const isLocked = $derived(!meetsRequiredTier(currentTier, requiredTier));
const requiredLabel = $derived(TIER_LABELS[requiredTier]);
</script>

{#if !isLocked}
	{@render children()}
{:else if locked}
	{@render locked()}
{:else if display === 'inline' && buttonLabel}
	<span class="feature-gate-inline">
		<button type="button" class="feature-gate-btn" disabled title={UI_COMPONENTS_LABELS.featureGateLockTitle(requiredLabel)}>
			<span class="feature-gate-btn__icon">🔒</span>
			<span class="feature-gate-btn__label">{buttonLabel}</span>
		</button>
		<PremiumBadge size="sm" label={requiredLabel} />
	</span>
{:else}
	<div class="feature-gate-section">
		<div class="feature-gate-overlay">
			<span class="feature-gate-lock">🔒</span>
			<p class="feature-gate-text">{UI_COMPONENTS_LABELS.featureGateLockText(requiredLabel)}</p>
			<PremiumBadge size="md" label={UI_COMPONENTS_LABELS.featureGateUpgrade} />
		</div>
		<div class="feature-gate-content" aria-hidden="true">
			{@render children()}
		</div>
	</div>
{/if}

<style>
	.feature-gate-inline {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.feature-gate-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		background: var(--color-surface-secondary);
		color: var(--color-text-tertiary);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: not-allowed;
		opacity: 0.6;
	}

	.feature-gate-btn__icon {
		font-size: 0.8rem;
	}

	.feature-gate-section {
		position: relative;
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.feature-gate-content {
		filter: blur(2px);
		opacity: 0.4;
		pointer-events: none;
		user-select: none;
	}

	.feature-gate-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		z-index: 10;
		background: var(--color-surface-overlay, rgba(255, 255, 255, 0.7));
		border-radius: var(--radius-md);
	}

	.feature-gate-lock {
		font-size: 1.5rem;
	}

	.feature-gate-text {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}
</style>
