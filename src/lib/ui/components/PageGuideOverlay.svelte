<script lang="ts">
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
let animKey = $state(0);

const active = $derived(isPageGuideActive());
const step = $derived(getCurrentGuideStep());
const guide = $derived(getCurrentGuideInfo());
const progress = $derived(getGuideProgress());
const isFirst = $derived(isFirstGuideStep());
const isLast = $derived(isLastGuideStep());

// 三部構成の表示タブ
let activeTab = $state<'what' | 'how' | 'goal'>('what');

// ステップ切替時にタブをリセット
$effect(() => {
	if (step) {
		activeTab = 'what';
	}
});

$effect(() => {
	if (active && step) {
		const timer = setTimeout(() => {
			const el = step.selector ? document.querySelector(step.selector) : null;
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				setTimeout(() => {
					targetRect = el.getBoundingClientRect();
					animKey++;
				}, 350);
			} else {
				targetRect = new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 3, 200, 40);
				animKey++;
			}
		}, 100);

		return () => clearTimeout(timer);
	}
	targetRect = null;
});

function handleOverlayClick(e: MouseEvent) {
	if ((e.target as HTMLElement).classList.contains('guide-overlay-bg')) {
		endPageGuide();
	}
}

const bubbleStyle = $derived.by(() => {
	if (!targetRect || !step) return { top: '50%', left: '50%', width: '360px' };
	const gap = 16;
	const bubbleWidth = 360;
	const pos = step.position ?? 'auto';
	const effectivePos = pos === 'auto' ? 'bottom' : pos;

	let top = 0;
	let left = 0;

	if (effectivePos === 'bottom') {
		top = targetRect.bottom + gap;
		left = targetRect.left + targetRect.width / 2 - bubbleWidth / 2;
	} else if (effectivePos === 'top') {
		top = targetRect.top - gap;
		left = targetRect.left + targetRect.width / 2 - bubbleWidth / 2;
	} else if (effectivePos === 'left') {
		top = targetRect.top + targetRect.height / 2;
		left = targetRect.left - bubbleWidth - gap;
	} else {
		top = targetRect.top + targetRect.height / 2;
		left = targetRect.right + gap;
	}

	left = Math.max(12, Math.min(left, window.innerWidth - bubbleWidth - 12));
	top = Math.max(12, Math.min(top, window.innerHeight - 400));

	return { top: `${top}px`, left: `${left}px`, width: `${bubbleWidth}px` };
});
</script>

{#if active && step && targetRect}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="guide-overlay" onclick={handleOverlayClick}>
		<!-- Dark overlay with spotlight cutout -->
		<svg class="guide-overlay-svg" xmlns="http://www.w3.org/2000/svg">
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

		<!-- Guide bubble -->
		{#key animKey}
			<div
				class="guide-bubble"
				style:top={bubbleStyle.top}
				style:left={bubbleStyle.left}
				style:width={bubbleStyle.width}
			>
				<!-- Header -->
				<div class="guide-header">
					<span class="guide-header-icon">{guide?.icon ?? '📖'}</span>
					<span class="guide-header-title">{guide?.title ?? ''}</span>
					<span class="guide-header-progress">{progress.current} / {progress.total}</span>
				</div>

				<!-- Step title -->
				<div class="guide-step-title">
					<h3>{step.title}</h3>
				</div>

				<!-- Tab navigation -->
				<div class="guide-tabs">
					<button
						class="guide-tab"
						class:active={activeTab === 'what'}
						onclick={() => (activeTab = 'what')}
					>
						なにができる？
					</button>
					<button
						class="guide-tab"
						class:active={activeTab === 'how'}
						onclick={() => (activeTab = 'how')}
					>
						やりかた
					</button>
					<button
						class="guide-tab"
						class:active={activeTab === 'goal'}
						onclick={() => (activeTab = 'goal')}
					>
						つかうと？
					</button>
				</div>

				<!-- Tab content -->
				<div class="guide-tab-content">
					{#if activeTab === 'what'}
						<p>{step.what}</p>
					{:else if activeTab === 'how'}
						<p class="guide-how-text">{step.how}</p>
					{:else}
						<p>{step.goal}</p>
					{/if}

					{#if step.tips && step.tips.length > 0}
						<div class="guide-tips">
							<span class="guide-tips-label">💡 ポイント</span>
							{#each step.tips as tip}
								<p class="guide-tip">{tip}</p>
							{/each}
						</div>
					{/if}

					{#if step.relatedLinks && step.relatedLinks.length > 0}
						<div class="guide-links">
							{#each step.relatedLinks as link}
								<a href={link.href} class="guide-link">{link.label} →</a>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Progress bar -->
				<div class="guide-progress-bar">
					<div
						class="guide-progress-fill"
						style:width="{(progress.current / progress.total) * 100}%"
					></div>
				</div>

				<!-- Navigation -->
				<div class="guide-nav">
					<button class="guide-nav-btn guide-nav-end" onclick={endPageGuide}>
						とじる
					</button>
					<div class="guide-nav-right">
						{#if !isFirst}
							<button class="guide-nav-btn guide-nav-prev" onclick={prevGuideStep}>
								もどる
							</button>
						{/if}
						<button class="guide-nav-btn guide-nav-next" onclick={nextGuideStep}>
							{isLast ? 'かんりょう！' : 'つぎへ'}
						</button>
					</div>
				</div>
			</div>
		{/key}
	</div>
{/if}

<style>
	.guide-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
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

	.guide-bubble {
		position: fixed;
		z-index: 110;
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

	.guide-tabs {
		display: flex;
		padding: 0 12px;
		gap: 4px;
	}

	.guide-tab {
		flex: 1;
		padding: 6px 8px;
		font-size: 0.75rem;
		font-weight: 600;
		border: none;
		border-radius: 8px 8px 0 0;
		cursor: pointer;
		background: var(--color-surface-muted, #f1f5f9);
		color: var(--color-text-muted, #64748b);
		transition: all 0.15s;
	}

	.guide-tab.active {
		background: var(--color-brand-50, #eff6ff);
		color: var(--color-action-primary, #3b82f6);
	}

	.guide-tab:hover:not(.active) {
		background: var(--color-surface-hover, #e2e8f0);
	}

	.guide-tab-content {
		padding: 12px 16px;
		min-height: 80px;
		background: var(--color-surface-card, #ffffff);
		border-top: 2px solid var(--color-brand-50, #eff6ff);
	}

	.guide-tab-content p {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-secondary, #475569);
		line-height: 1.6;
		white-space: pre-line;
	}

	.guide-how-text {
		font-size: 0.85rem;
	}

	.guide-tips {
		margin-top: 10px;
		padding: 8px 10px;
		background: var(--color-surface-muted, #fffbeb);
		border-radius: 8px;
	}

	.guide-tips-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-primary, #92400e);
	}

	.guide-tip {
		margin: 4px 0 0 !important;
		font-size: 0.8rem !important;
		color: var(--color-text-secondary, #78716c) !important;
	}

	.guide-links {
		margin-top: 8px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.guide-link {
		font-size: 0.8rem;
		color: var(--color-action-primary, #3b82f6);
		text-decoration: none;
	}

	.guide-link:hover {
		text-decoration: underline;
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
