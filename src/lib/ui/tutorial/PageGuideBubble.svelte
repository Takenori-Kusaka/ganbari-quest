<script lang="ts">
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
import PageGuideTabs from '$lib/ui/tutorial/PageGuideTabs.svelte';
import type { GuideStep, PageGuide } from '$lib/ui/tutorial/page-guide-types';

interface Props {
	step: GuideStep;
	guide: PageGuide | null;
	progress: { current: number; total: number };
	isFirst: boolean;
	isLast: boolean;
	bubbleStyle: { top: string; left: string; width: string };
	onEnd: () => void;
	onPrev: () => void;
	onNext: () => void;
}

let { step, guide, progress, isFirst, isLast, bubbleStyle, onEnd, onPrev, onNext }: Props =
	$props();
</script>

<!--
  #2375 AC-V2-4: 旧 `{#key animKey}` を撤廃。
  これにより step 切替時に bubble DOM が破棄されず、tab フォーカス・SR 読み上げ・現在 activeTab が維持される。
  値は Svelte 5 の reactive プロパティ更新で自然に追従する。
-->
<div
	class="guide-bubble"
	style:top={bubbleStyle.top}
	style:left={bubbleStyle.left}
	style:width={bubbleStyle.width}
	data-step-id={step.id}
>
	<!-- Header -->
	<div class="guide-header">
		<span class="guide-header-icon">{guide?.icon ?? '📖'}</span>
		<span id="page-guide-title" class="guide-header-title">{guide?.title ?? ''}</span>
		<span class="guide-header-progress">{progress.current} / {progress.total}</span>
	</div>

	<!-- Step title -->
	<div class="guide-step-title">
		<h3>{step.title}</h3>
	</div>

	<!-- Tabs (what / how / goal) + Tab content (tips / links 含む) -->
	<PageGuideTabs {step} />

	<!-- Progress bar -->
	<div class="guide-progress-bar">
		<div
			class="guide-progress-fill"
			style:width="{(progress.current / progress.total) * 100}%"
		></div>
	</div>

	<!-- Navigation -->
	<div class="guide-nav">
		<button class="guide-nav-btn guide-nav-end" onclick={onEnd}>
			{UI_COMPONENTS_LABELS.pageGuideCloseBtn}
		</button>
		<div class="guide-nav-right">
			{#if !isFirst}
				<button class="guide-nav-btn guide-nav-prev" onclick={onPrev}>
					{UI_COMPONENTS_LABELS.pageGuideBackBtn}
				</button>
			{/if}
			<button class="guide-nav-btn guide-nav-next" onclick={onNext}>
				{UI_COMPONENTS_LABELS.pageGuideNextBtn(isLast)}
			</button>
		</div>
	</div>
</div>

<style>
	.guide-bubble {
		position: fixed;
		/* #2106: bubble sits +10 above overlay (callout layering within --z-tutorial tier) */
		z-index: calc(var(--z-tutorial) + 10);
		background: white;
		border-radius: 16px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.05);
		overflow: hidden;
		animation: guide-bubble-appear 0.3s ease-out;
		pointer-events: auto;
		max-height: 80vh;
		overflow-y: auto;
	}

	@keyframes guide-bubble-appear {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.guide-header {
		background: linear-gradient(135deg, var(--color-action-primary, #3b82f6), var(--color-brand-700, #2563eb));
		padding: 10px 14px;
		display: flex;
		align-items: center;
		gap: 8px;
		color: white;
	}

	.guide-header-icon {
		font-size: 1.1rem;
	}

	.guide-header-title {
		font-size: 0.85rem;
		font-weight: 600;
		flex: 1;
	}

	.guide-header-progress {
		font-size: 0.75rem;
		opacity: 0.8;
	}

	.guide-step-title {
		padding: 14px 16px 8px;
	}

	.guide-step-title h3 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--color-text-primary, #1e293b);
	}

	.guide-progress-bar {
		height: 3px;
		background: var(--color-surface-muted, #e2e8f0);
		margin: 0 16px;
	}

	.guide-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--color-action-primary, #3b82f6), var(--color-brand-600, #7c3aed));
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.guide-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px 14px;
		gap: 8px;
	}

	.guide-nav-right {
		display: flex;
		gap: 6px;
	}

	.guide-nav-btn {
		padding: 7px 16px;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}

	.guide-nav-end {
		background: var(--color-surface-muted, #f1f5f9);
		color: var(--color-text-muted, #64748b);
	}

	.guide-nav-end:hover {
		background: var(--color-surface-hover, #e2e8f0);
	}

	.guide-nav-prev {
		background: var(--color-surface-muted, #f1f5f9);
		color: var(--color-text-secondary, #475569);
	}

	.guide-nav-prev:hover {
		background: var(--color-surface-hover, #e2e8f0);
	}

	.guide-nav-next {
		background: linear-gradient(135deg, var(--color-action-primary, #3b82f6), var(--color-brand-700, #2563eb));
		color: white;
	}

	.guide-nav-next:hover {
		filter: brightness(1.1);
	}

	.guide-nav-next:active {
		transform: scale(0.97);
	}
</style>
