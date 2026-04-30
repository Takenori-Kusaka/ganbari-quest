<script lang="ts">
import { CHILD_HOME_LABELS } from '$lib/domain/labels';
import type { UiMode } from '$lib/domain/validation/age-tier';
import Card from '$lib/ui/primitives/Card.svelte';
import Progress from '$lib/ui/primitives/Progress.svelte';

/**
 * #1757 (#1709-C): 「今日のおやくそく」N/M 進捗バー。
 *
 * - `total === 0` の場合、呼び出し側で本コンポーネントを描画しない（条件付き mount）。
 * - baby モードは呼び出し側で除外する（親準備モードはバー非表示 — ADR-0011）。
 *
 * Anti-engagement (ADR-0012):
 * - pulse 演出 1 回限り（CSS animation duration <= 1.5s で完全消失）
 * - モーダル / Dialog を出さず、バー上のテキスト + 親が並列で表示する Toast のみで完結
 */
interface Props {
	/** 今日達成した must 活動数 */
	logged: number;
	/** must 活動の総数（>= 1） */
	total: number;
	/** 子供の UI モード（preschool は ひらがな表記、それ以外は漢字表記） */
	uiMode: UiMode;
	/** 全達成時に bonus が今この load で加算されたか（pulse 演出用） */
	bonusGranted?: boolean;
	/** 加算された bonus pt 値（granted の時のみ表示） */
	bonusPoints?: number;
}

let { logged, total, uiMode, bonusGranted = false, bonusPoints = 0 }: Props = $props();

const allComplete = $derived(total > 0 && logged === total);
const remaining = $derived(Math.max(0, total - logged));
// preschool は ひらがな表記、elementary 以上は 漢字表記
const titleText = $derived(
	uiMode === 'preschool' ? CHILD_HOME_LABELS.mustTitleKana : CHILD_HOME_LABELS.mustTitle,
);
// 全達成時は緑（success）、未達成時はテーマカラー
const barColor = $derived(allComplete ? 'var(--color-success)' : 'var(--theme-primary)');
</script>

<Card variant="default" padding="sm">
	<div class="must-bar" class:must-bar--complete={allComplete} class:must-bar--pulse={allComplete && bonusGranted} data-testid="must-progress-bar" data-must-complete={allComplete ? '1' : '0'}>
		<div class="must-bar__header">
			<p class="must-bar__title" data-testid="must-progress-title">{titleText}</p>
			<p class="must-bar__count" data-testid="must-progress-count">{CHILD_HOME_LABELS.mustProgressText(logged, total)}</p>
		</div>
		<Progress value={logged} max={total} color={barColor} size="md" />
		<div class="must-bar__caption" aria-live="polite">
			{#if allComplete}
				<span class="must-bar__done" data-testid="must-progress-complete">
					<span aria-hidden="true">{CHILD_HOME_LABELS.mustAllCompleteEmoji}</span>
					{CHILD_HOME_LABELS.mustAllComplete}
					{#if bonusGranted && bonusPoints > 0}
						<span class="must-bar__bonus" data-testid="must-progress-bonus" aria-label={CHILD_HOME_LABELS.mustBonusGrantedAriaLabel(bonusPoints)}>
							{CHILD_HOME_LABELS.mustBonusGranted(bonusPoints)}
						</span>
					{/if}
				</span>
			{:else}
				<span class="must-bar__remaining" data-testid="must-progress-remaining">
					{CHILD_HOME_LABELS.mustRemaining(remaining)}
				</span>
			{/if}
		</div>
	</div>
</Card>

<style>
	.must-bar {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.must-bar__header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.must-bar__title {
		font-weight: 700;
		font-size: 0.9rem;
		color: var(--color-text-primary);
	}
	.must-bar__count {
		font-weight: 700;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.must-bar__caption {
		font-size: 0.75rem;
		min-height: 1.1em;
	}
	.must-bar__remaining {
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.must-bar__done {
		color: var(--color-feedback-success-text);
		font-weight: 700;
		display: inline-flex;
		gap: 4px;
		align-items: center;
	}
	.must-bar__bonus {
		background: var(--color-feedback-success-bg-strong);
		color: var(--color-feedback-success-text);
		border-radius: var(--radius-full, 999px);
		padding: 1px 8px;
		font-size: 0.75rem;
		margin-left: 2px;
	}

	/* Anti-engagement (ADR-0012): pulse 1 回 / 1.5s 以内に完全消失 */
	.must-bar--pulse {
		animation: must-bar-pulse 1.2s ease-out 1;
	}
	@keyframes must-bar-pulse {
		0% { transform: scale(1); }
		25% { transform: scale(1.03); }
		50% { transform: scale(1); }
		100% { transform: scale(1); }
	}
	@media (prefers-reduced-motion: reduce) {
		.must-bar--pulse {
			animation: none;
		}
	}
</style>
