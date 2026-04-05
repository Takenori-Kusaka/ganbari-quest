<script lang="ts">
import {
	endTutorial,
	getCurrentStep,
	isTutorialActive,
} from '$lib/ui/tutorial/tutorial-store.svelte';
import TutorialBubble from './TutorialBubble.svelte';

let targetRect = $state<DOMRect | null>(null);
let animKey = $state(0);

const active = $derived(isTutorialActive());
const step = $derived(getCurrentStep());

/** Find the first visible element matching a selector (handles responsive layouts) */
function findVisibleElement(selector: string): Element | null {
	const candidates = document.querySelectorAll(selector);
	for (const el of candidates) {
		const rect = el.getBoundingClientRect();
		// Skip elements with zero dimensions (e.g. hidden by CSS display:none)
		if (rect.width > 0 && rect.height > 0) return el;
	}
	// Fallback to first match even if hidden
	return candidates[0] ?? null;
}

$effect(() => {
	if (active && step) {
		// Small delay to ensure DOM elements are rendered after page navigation
		const timer = setTimeout(() => {
			const el = step.selector ? findVisibleElement(step.selector) : null;
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				// Update rect after scroll settles
				setTimeout(() => {
					targetRect = el.getBoundingClientRect();
					animKey++;
				}, 350);
			} else {
				// Element not found — still show bubble at center
				targetRect = new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 3, 200, 40);
				animKey++;
			}
		}, 100);

		return () => clearTimeout(timer);
	}
	targetRect = null;
});

function handleOverlayClick(e: MouseEvent) {
	// Only close if clicking the dark overlay itself, not the bubble
	if ((e.target as HTMLElement).classList.contains('tutorial-overlay-bg')) {
		endTutorial();
	}
}
</script>

{#if active && step && targetRect}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="tutorial-overlay" onclick={handleOverlayClick}>
		<!-- Dark overlay with spotlight cutout -->
		<svg class="tutorial-overlay-svg" xmlns="http://www.w3.org/2000/svg">
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

		<!-- Bubble -->
		{#key animKey}
			<TutorialBubble {step} {targetRect} />
		{/key}
	</div>
{/if}

<style>
	.tutorial-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
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
		cursor: pointer;
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
</style>
