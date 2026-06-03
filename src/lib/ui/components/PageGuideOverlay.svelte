<script lang="ts">
import PageGuideBubble from '$lib/ui/tutorial/PageGuideBubble.svelte';
import {
	endPageGuide,
	getCurrentGuideInfo,
	getCurrentGuideStep,
	getGuideProgress,
	isFirstGuideStep,
	isLastGuideStep,
	isPageGuideActive,
	nextGuideStep,
	prevGuideStep,
} from '$lib/ui/tutorial/page-guide-store.svelte';

let targetRect = $state<DOMRect | null>(null);

const active = $derived(isPageGuideActive());
const step = $derived(getCurrentGuideStep());
const guide = $derived(getCurrentGuideInfo());
const progress = $derived(getGuideProgress());
const isFirst = $derived(isFirstGuideStep());
const isLast = $derived(isLastGuideStep());

// #2375 AC-V2-3/9: AbortController で setTimeout 群を cleanup + selector 解決時 focus
$effect(() => {
	if (active && step) {
		const ctrl = new AbortController();
		const outerTimer = setTimeout(() => {
			if (ctrl.signal.aborted) return;
			const el = step.selector
				? (document.querySelector(step.selector) as HTMLElement | null)
				: null;
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				const innerTimer = setTimeout(() => {
					if (ctrl.signal.aborted) return;
					targetRect = el.getBoundingClientRect();
					try {
						el.focus({ preventScroll: true });
					} catch {
						/* focus 不可要素はスキップ (#2371 focus trap 対応) */
					}
				}, 350);
				ctrl.signal.addEventListener('abort', () => clearTimeout(innerTimer));
			} else {
				targetRect = new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 3, 200, 40);
			}
		}, 100);

		return () => {
			ctrl.abort();
			clearTimeout(outerTimer);
		};
	}
	targetRect = null;
});

// #2375 AC-V2-6: Escape で閉じる
function handleKeydown(e: KeyboardEvent) {
	if (active && e.key === 'Escape') {
		e.preventDefault();
		endPageGuide();
	}
}

function handleOverlayClick(e: MouseEvent) {
	if ((e.target as HTMLElement).classList.contains('guide-overlay-bg')) {
		endPageGuide();
	}
}

const bubbleStyle = $derived.by(() => {
	if (!targetRect || !step) return { top: '50%', left: '50%', width: '360px' };
	const gap = 16;
	const bw = 360;
	const r = targetRect;
	const pos = (step.position ?? 'auto') === 'auto' ? 'bottom' : step.position;
	let top = 0;
	let left = 0;
	if (pos === 'bottom') {
		top = r.bottom + gap;
		left = r.left + r.width / 2 - bw / 2;
	} else if (pos === 'top') {
		top = r.top - gap;
		left = r.left + r.width / 2 - bw / 2;
	} else if (pos === 'left') {
		top = r.top + r.height / 2;
		left = r.left - bw - gap;
	} else {
		top = r.top + r.height / 2;
		left = r.right + gap;
	}
	left = Math.max(12, Math.min(left, window.innerWidth - bw - 12));
	top = Math.max(12, Math.min(top, window.innerHeight - 400));
	return { top: `${top}px`, left: `${left}px`, width: `${bw}px` };
});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if active && step && targetRect}
	<!-- #2375 AC-V2-7: a11y 強化 — role="dialog" + aria-modal + aria-labelledby + tabindex="-1" (modal dialog 標準) -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="guide-overlay"
		onclick={handleOverlayClick}
		role="dialog"
		aria-modal="true"
		aria-labelledby="page-guide-title"
		tabindex="-1"
	>
		<!-- Dark overlay with spotlight cutout (装飾的マスクのみ。情報は dialog 本文が保持するため SR は skip) -->
		<svg class="guide-overlay-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<defs>
				<mask id="guide-spotlight">
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
				class="guide-overlay-bg"
				width="100%"
				height="100%"
				fill="rgba(0,0,0,0.6)"
				mask="url(#guide-spotlight)"
			/>
		</svg>

		<!-- Spotlight ring -->
		<div
			class="guide-spotlight-ring"
			style:top="{targetRect.y - 10}px"
			style:left="{targetRect.x - 10}px"
			style:width="{targetRect.width + 20}px"
			style:height="{targetRect.height + 20}px"
		></div>

		<PageGuideBubble
			{step}
			{guide}
			{progress}
			{isFirst}
			{isLast}
			{bubbleStyle}
			onEnd={endPageGuide}
			onPrev={prevGuideStep}
			onNext={nextGuideStep}
		/>
	</div>
{/if}

<style>
	.guide-overlay {
		position: fixed;
		inset: 0;
		/* #2106: DESIGN section 10 z-index token migration (replaces hardcoded z-index: 100) */
		z-index: var(--z-tutorial);
	}

	.guide-overlay-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.guide-overlay-bg {
		pointer-events: auto;
		cursor: pointer;
	}

	.guide-spotlight-ring {
		position: absolute;
		border: 2px solid rgba(59, 130, 246, 0.6);
		border-radius: 12px;
		box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
		pointer-events: none;
		animation: guide-ring-pulse 2s ease-in-out infinite;
	}

	@keyframes guide-ring-pulse {
		0%, 100% {
			box-shadow: 0 0 12px rgba(59, 130, 246, 0.3);
		}
		50% {
			box-shadow: 0 0 24px rgba(59, 130, 246, 0.5);
		}
	}
</style>
