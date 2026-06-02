<script lang="ts">
import {
	cancelExit,
	confirmExit,
	getAnimKey,
	getShowExitConfirm,
	getShowQuickComplete,
	getShowResume,
	getStep,
	getTargetRect,
	handleOverlayClick,
	isActive,
	setupResizeScrollTracking,
	setupStepTracking,
	setupTutorialActiveFlag,
} from '$lib/ui/tutorial/tutorial-step-controller.svelte';
import TutorialBubble from './TutorialBubble.svelte';
import TutorialQuickCompleteDialog from './TutorialQuickCompleteDialog.svelte';

const active = $derived(isActive());
const step = $derived(getStep());
const targetRect = $derived(getTargetRect());
const animKey = $derived(getAnimKey());
const showResume = $derived(getShowResume());
const showQuickComplete = $derived(getShowQuickComplete());
const showExitConfirm = $derived(getShowExitConfirm() && active);

// Setup effects (must be called within component context)
setupTutorialActiveFlag();
setupStepTracking();
setupResizeScrollTracking();
</script>

<!-- Dialogs: resume, quickComplete, exitConfirm -->
<TutorialQuickCompleteDialog
	{showResume}
	{showQuickComplete}
	{showExitConfirm}
	onConfirmExit={confirmExit}
	onCancelExit={cancelExit}
/>

<!-- #2105: showExitConfirm 表示中も TutorialBubble を隠し二重ダイアログ状態を防止 (Dialog FSM 排他原則、archive ADR-0019) -->
{#if active && step && targetRect && !showQuickComplete && !showExitConfirm}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="tutorial-overlay" onclick={handleOverlayClick}>
		<!-- Dark overlay with spotlight cutout (装飾的マスクのみ。情報は TutorialBubble が保持するため SR は skip) -->
		<svg class="tutorial-overlay-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<defs>
				<mask id="tutorial-spotlight">
					<rect width="100%" height="100%" fill="white" />
					<rect
						x={targetRect.x - 8}
						y={targetRect.y - 8}
						width={targetRect.width + 16}
						height={targetRect.height + 16}
						rx="12"
						fill="black"
					/>
				</mask>
			</defs>
			<rect
				class="tutorial-overlay-bg"
				width="100%"
				height="100%"
				fill="rgba(0,0,0,0.6)"
				mask="url(#tutorial-spotlight)"
			/>
		</svg>

		<!-- Spotlight border glow -->
		<div
			class="tutorial-spotlight-ring"
			style:top="{targetRect.y - 10}px"
			style:left="{targetRect.x - 10}px"
			style:width="{targetRect.width + 20}px"
			style:height="{targetRect.height + 20}px"
		></div>

		<!-- Bubble: {#key} による DOM 削除を廃止し animKey prop 経由でアニメーション再生 (#1468) -->
		<TutorialBubble {step} {targetRect} {animKey} />
	</div>
{/if}

<style>
	.tutorial-overlay {
		position: fixed;
		inset: 0;
		/* #2106: DESIGN section 10 z-index token migration (replaces hardcoded z-index: 100) */
		z-index: var(--z-tutorial);
	}

	.tutorial-overlay-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.tutorial-overlay-bg {
		pointer-events: auto;
		cursor: default;
	}

	.tutorial-spotlight-ring {
		position: absolute;
		border: 2px solid rgba(59, 130, 246, 0.6);
		border-radius: 12px;
		box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
		pointer-events: none;
		animation: ring-pulse 2s ease-in-out infinite;
	}

	@keyframes ring-pulse {
		0%, 100% {
			box-shadow: 0 0 12px rgba(59, 130, 246, 0.3);
		}
		50% {
			box-shadow: 0 0 24px rgba(59, 130, 246, 0.5);
		}
	}

	/* A. During tutorial, suppress nav/header z-index below the overlay */
	:global([data-tutorial-active]) :global(.z-30) {
		z-index: 10 !important;
	}
	:global([data-tutorial-active]) :global(.desktop-dropdown) {
		z-index: 10 !important;
	}
</style>
