<script lang="ts">
import {
	cancelExit,
	confirmExit,
	getAnimKey,
	getShowExitConfirm,
	getShowResume,
	getStep,
	getTargetRect,
	handleOverlayClick,
	isActive,
	isTargetResolved,
	setupResizeScrollTracking,
	setupStepTracking,
	setupTutorialActiveFlag,
} from '$lib/ui/tutorial/tutorial-step-controller.svelte';
import TutorialBubble from './TutorialBubble.svelte';
import TutorialDialogs from './TutorialDialogs.svelte';

interface Props {
	/**
	 * 子供画面で表示するときの年齢モード (#4652)。
	 * 指定すると再開 / 終了確認ダイアログの文言を子供向け年齢帯 variant
	 * (preschool / elementary = ひらがな、junior / senior = 漢字) にする。
	 * 親管理画面では未指定 (親向け漢字文言のまま)。
	 */
	childUiMode?: string;
}

let { childUiMode }: Props = $props();

interface Props {
	/**
	 * 子供画面で表示するときの年齢モード (#4652)。
	 * 指定すると再開 / 終了確認ダイアログの文言を子供向け年齢帯 variant
	 * (preschool / elementary = ひらがな、junior / senior = 漢字) にする。
	 * 親管理画面では未指定 (親向け漢字文言のまま)。
	 */
	childUiMode?: string;
}

let { childUiMode }: Props = $props();

const active = $derived(isActive());
const step = $derived(getStep());
const targetRect = $derived(getTargetRect());
const animKey = $derived(getAnimKey());
const showResume = $derived(getShowResume());
const showExitConfirm = $derived(getShowExitConfirm() && active);
// #4652: selector 指定 step が実要素に spotlight できたか (E2E が機械検証する)
const targetResolved = $derived(isTargetResolved());

// Setup effects (must be called within component context)
setupTutorialActiveFlag();
setupStepTracking();
setupResizeScrollTracking();
</script>

<!-- Dialogs: resume, exitConfirm -->
<TutorialDialogs
	{showResume}
	{showExitConfirm}
	{childUiMode}
	onConfirmExit={confirmExit}
	onCancelExit={cancelExit}
/>

<!-- #2105: showExitConfirm 表示中も TutorialBubble を隠し二重ダイアログ状態を防止 (Dialog FSM 排他原則、archive ADR-0019) -->
<!-- #4651: targetRect が無い step (概要 step / 対象未発見) でも overlay は出す。
     ただし cutout / ring は描かず、中央に偽の spotlight を作らない。 -->
{#if active && step && !showExitConfirm}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="tutorial-overlay"
		data-tutorial-target={targetResolved ? 'resolved' : 'fallback'}
		onclick={handleOverlayClick}
	>
		<!-- Dark overlay with spotlight cutout (装飾的マスクのみ。情報は TutorialBubble が保持するため SR は skip) -->
		<svg class="tutorial-overlay-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			{#if targetRect}
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
			{/if}
			<!-- #4651: 暗幕の rect は常に同じ要素を使い、cutout の有無は mask 属性の付け外しだけで
			     切り替える。対象解決のたびに rect を作り直すと、その瞬間の click が破棄済ノードに落ちて
			     「背景を押しても終了確認が出ない」瞬間ができる。対象なしのときは cutout を描かない
			     (= 偽 spotlight を作らない)。 -->
			<rect
				class="tutorial-overlay-bg"
				width="100%"
				height="100%"
				fill="rgba(0,0,0,0.6)"
				mask={targetRect ? 'url(#tutorial-spotlight)' : null}
			/>
		</svg>

		<!-- Spotlight border glow (対象がある step のみ) -->
		{#if targetRect}
			<div
				class="tutorial-spotlight-ring"
				style:top="{targetRect.y - 10}px"
				style:left="{targetRect.x - 10}px"
				style:width="{targetRect.width + 20}px"
				style:height="{targetRect.height + 20}px"
			></div>
		{/if}

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
