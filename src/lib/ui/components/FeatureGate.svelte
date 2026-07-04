<script lang="ts">
import { Popover } from '@ark-ui/svelte/popover';
import { Portal } from '@ark-ui/svelte/portal';
import type { Snippet } from 'svelte';
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
import { PLAN_FULL_TERMS, PLAN_TERMS } from '$lib/domain/terms';
import { meetsRequiredTier, type PlanTier } from '$lib/ui/tutorial/tutorial-types';

/**
 * FeatureGate (EPIC #3533 §10.2 で popover 化)
 *
 * free/standard ユーザーが有料機能に触れたとき「存在は示す・操作不可 (disabled)」に留め、
 * 画面内に個別アップセル CTA / quota カウンタを置かない (P1/P3)。disabled 要素の tap で
 * popover を開き ① 利用不可 ② 対象プラン名 ③ プラン画面リンク1本 を示す (P2、§10.2.1)。
 *
 * disabled は native `disabled` 属性ではなく `aria-disabled="true"` で表現する — native disabled
 * だと tap イベントが発火せず popover を開けないため。gated 操作の実行ハンドラは本 component が
 * 肩代わりせず、trigger は popover を開くだけ (実行不可)。バックエンド 403 (requirePaidTier 等) が
 * 唯一の砦で、本 component は二重防御。
 */

interface Props {
	/** 現在のプラン */
	currentTier: PlanTier;
	/** この機能に必要な最低プラン */
	requiredTier: PlanTier;
	/** 有料機能へのコンテンツ */
	children: Snippet;
	/** ロック時の代替表示 (省略時はデフォルトの 🔒 disabled + popover) */
	locked?: Snippet;
	/** disabled ボタンとして表示する場合のラベル (display="inline" 用) */
	buttonLabel?: string;
	/** インライン表示（ボタン用）か、セクション表示か */
	display?: 'inline' | 'section';
	/** popover のプラン画面リンク先 (§10.2.1、既定 = プラン画面) */
	planPageHref?: string;
	/**
	 * quota ゲート (§10.2.2)。plan-limit-service の `{ allowed, current, max }` をそのまま渡す。
	 * 指定時は tier ではなく quota で開閉を判定する:
	 *   - max === null (無制限): ゲート痕跡を一切描画しない (children をそのまま操作可)
	 *   - allowed (current < max): 操作可
	 *   - 到達 (!allowed): disabled + popover
	 * requiredTier は「上限を引き上げる対象プラン名」として popover 文言に使う。
	 */
	quota?: { allowed: boolean; current: number; max: number | null };
}

let {
	currentTier,
	requiredTier,
	children,
	locked,
	buttonLabel,
	display = 'section',
	planPageHref = '/admin/subscription',
	quota,
}: Props = $props();

const TIER_LABELS: Record<PlanTier, string> = {
	free: PLAN_TERMS.free,
	standard: PLAN_TERMS.standard,
	family: PLAN_TERMS.premium,
};

// popover の「対象プラン名」はフル形 (「スタンダードプラン」) を使う (§10.2.1 ②)。
const TIER_FULL_LABELS: Record<PlanTier, string> = {
	free: PLAN_FULL_TERMS.free,
	standard: PLAN_FULL_TERMS.standard,
	family: PLAN_FULL_TERMS.premium,
};

// quota 指定時は quota で判定 (§10.2.2)。max===null は無制限 = 非ロック (ゲート痕跡なし)。
// quota 未指定時は tier で判定 (tutorial-chapters / page-guide と同じ TIER_ORDER SSOT)。
const isLocked = $derived(
	quota ? quota.max !== null && !quota.allowed : !meetsRequiredTier(currentTier, requiredTier),
);
const requiredLabel = $derived(TIER_LABELS[requiredTier]);
const requiredFullLabel = $derived(TIER_FULL_LABELS[requiredTier]);
</script>

{#snippet popoverBody()}
	<Portal>
		<Popover.Positioner class="feature-gate-popover-positioner">
			<Popover.Content class="feature-gate-popover" data-testid="feature-gate-popover">
				<Popover.Title class="feature-gate-popover__title">
					{UI_COMPONENTS_LABELS.featureGatePopoverUnavailable}
				</Popover.Title>
				<Popover.Description class="feature-gate-popover__desc">
					{UI_COMPONENTS_LABELS.featureGatePopoverRequirement(requiredFullLabel)}
				</Popover.Description>
				<a href={planPageHref} class="feature-gate-popover__link" data-testid="feature-gate-popover-link">
					{UI_COMPONENTS_LABELS.featureGatePopoverLink}
				</a>
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
{/snippet}

{#if !isLocked}
	{@render children()}
{:else if locked}
	{@render locked()}
{:else if display === 'inline' && buttonLabel}
	<Popover.Root positioning={{ placement: 'top' }}>
		<Popover.Trigger
			class="feature-gate-btn"
			aria-disabled="true"
			data-testid="feature-gate-locked-trigger"
			title={UI_COMPONENTS_LABELS.featureGateLockTitle(requiredLabel)}
		>
			<span class="feature-gate-btn__icon" aria-hidden="true">🔒</span>
			<span class="feature-gate-btn__label">{buttonLabel}</span>
		</Popover.Trigger>
		{@render popoverBody()}
	</Popover.Root>
{:else}
	<div class="feature-gate-section">
		<Popover.Root positioning={{ placement: 'top' }}>
			<Popover.Trigger
				class="feature-gate-overlay"
				aria-disabled="true"
				data-testid="feature-gate-locked-trigger"
				title={UI_COMPONENTS_LABELS.featureGateLockTitle(requiredLabel)}
			>
				<span class="feature-gate-lock" aria-hidden="true">🔒</span>
				<span class="feature-gate-text">
					{UI_COMPONENTS_LABELS.featureGateLockText(requiredLabel)}
				</span>
			</Popover.Trigger>
			{@render popoverBody()}
		</Popover.Root>
		<div class="feature-gate-content" aria-hidden="true">
			{@render children()}
		</div>
	</div>
{/if}

<style>
	/* class passed to Ark Popover.Trigger crosses the component boundary -> :global (same as Menu.svelte) */
	:global(.feature-gate-btn) {
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

	:global(.feature-gate-overlay) {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		z-index: var(--z-dropdown);
		background: var(--color-surface-overlay, rgba(255, 255, 255, 0.7));
		border: none;
		border-radius: var(--radius-md);
		cursor: not-allowed;
	}

	.feature-gate-lock {
		font-size: 1.5rem;
	}

	.feature-gate-text {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	:global(.feature-gate-popover-positioner) {
		/* DESIGN section 10: --z-dropdown = 20 token (popover layer, no raw z-index) */
		z-index: var(--z-dropdown);
	}

	:global(.feature-gate-popover) {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 16rem;
		padding: 0.75rem 1rem;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		outline: none;
	}

	:global(.feature-gate-popover__title) {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	:global(.feature-gate-popover__desc) {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
	}

	:global(.feature-gate-popover__link) {
		align-self: flex-start;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-link);
		text-decoration: underline;
	}
</style>
