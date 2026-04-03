<script lang="ts">
import {
	endTutorial,
	getChapters,
	getCurrentChapterInfo,
	getProgress,
	nextStep,
	prevStep,
	skipToChapter,
} from '$lib/ui/tutorial/tutorial-store.svelte';
import type { TutorialStep } from '$lib/ui/tutorial/tutorial-types';

interface Props {
	step: TutorialStep;
	targetRect: DOMRect;
}

let { step, targetRect }: Props = $props();
let showChapterMenu = $state(false);

const progress = $derived(getProgress());
const chapterInfo = $derived(getCurrentChapterInfo());
const chapters = getChapters();

const bubbleStyle = $derived.by(() => {
	const gap = 16;
	const bubbleWidth = 320;
	const pos = step.position === 'auto' ? 'bottom' : step.position;

	let top = 0;
	let left = 0;

	if (pos === 'bottom') {
		top = targetRect.bottom + gap;
		left = targetRect.left + targetRect.width / 2 - bubbleWidth / 2;
	} else if (pos === 'top') {
		top = targetRect.top - gap;
		left = targetRect.left + targetRect.width / 2 - bubbleWidth / 2;
	} else if (pos === 'left') {
		top = targetRect.top + targetRect.height / 2;
		left = targetRect.left - bubbleWidth - gap;
	} else {
		top = targetRect.top + targetRect.height / 2;
		left = targetRect.right + gap;
	}

	// Clamp to viewport
	left = Math.max(12, Math.min(left, window.innerWidth - bubbleWidth - 12));
	if (pos === 'top') {
		// Will be transformed upwards
	}
	top = Math.max(12, Math.min(top, window.innerHeight - 280));

	return { top: `${top}px`, left: `${left}px`, width: `${bubbleWidth}px` };
});

const isFirst = $derived(progress.current === 1);
const isLast = $derived(progress.current === progress.total);

// 年齢帯別のナビラベル（baby/kinder はひらがなのみ）
const ageTier = $derived.by(() => {
	if (typeof document === 'undefined') return '';
	return document.querySelector('[data-age-tier]')?.getAttribute('data-age-tier') ?? '';
});
const isYoungTier = $derived(['baby', 'kinder'].includes(ageTier));
const labelEnd = $derived(isYoungTier ? 'おわり' : '終了');
const labelPrev = $derived(isYoungTier ? 'もどる' : '戻る');
const labelNext = $derived(
	isYoungTier ? (isLast ? 'おしまい！' : 'つぎへ') : isLast ? '完了！' : '次へ',
);

function handleEnd() {
	endTutorial();
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="tutorial-bubble"
	style:top={bubbleStyle.top}
	style:left={bubbleStyle.left}
	style:width={bubbleStyle.width}
	class:bubble-top={step.position === 'top'}
>
	<!-- Chapter header -->
	<div class="tutorial-chapter-header">
		<button
			class="tutorial-chapter-btn"
			onclick={() => (showChapterMenu = !showChapterMenu)}
		>
			{chapterInfo?.icon ?? '📖'}
			<span>{chapterInfo?.title ?? ''}</span>
			<span class="tutorial-chapter-arrow">{showChapterMenu ? '▲' : '▼'}</span>
		</button>
	</div>

	{#if showChapterMenu}
		<div class="tutorial-chapter-menu">
			{#each chapters as ch}
				<button
					class="tutorial-chapter-menu-item"
					class:active={ch.id === chapterInfo?.id}
					onclick={() => {
						showChapterMenu = false;
						skipToChapter(ch.id);
					}}
				>
					<span>{ch.icon}</span>
					<span>{ch.title}</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Content -->
	<div class="tutorial-content">
		<h3 class="tutorial-title">{step.title}</h3>
		<p class="tutorial-description">{step.description}</p>
	</div>

	<!-- Progress -->
	<div class="tutorial-progress">
		<span class="tutorial-progress-text">{progress.current} / {progress.total}</span>
		<div class="tutorial-progress-bar">
			<div
				class="tutorial-progress-fill"
				style:width="{(progress.current / progress.total) * 100}%"
			></div>
		</div>
	</div>

	<!-- Navigation -->
	<div class="tutorial-nav">
		<button
			class="tutorial-nav-btn tutorial-nav-end"
			onclick={handleEnd}
		>
			{labelEnd}
		</button>
		<div class="tutorial-nav-right">
			{#if !isFirst}
				<button
					class="tutorial-nav-btn tutorial-nav-prev"
					onclick={() => prevStep()}
				>
					{labelPrev}
				</button>
			{/if}
			<button
				class="tutorial-nav-btn tutorial-nav-next"
				onclick={() => nextStep()}
			>
				{labelNext}
			</button>
		</div>
	</div>
</div>

<style>
	.tutorial-bubble {
		position: fixed;
		z-index: 110;
		background: white;
		border-radius: 16px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.05);
		padding: 0;
		overflow: hidden;
		animation: bubble-appear 0.3s ease-out;
		pointer-events: auto;
	}

	@keyframes bubble-appear {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.tutorial-chapter-header {
		background: linear-gradient(135deg, #3b82f6, #2563eb);
		padding: 8px 12px;
	}

	.tutorial-chapter-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		color: white;
		font-size: 0.8rem;
		font-weight: 600;
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
		width: 100%;
	}

	.tutorial-chapter-btn:hover {
		background: rgba(255, 255, 255, 0.15);
	}

	.tutorial-chapter-arrow {
		margin-left: auto;
		font-size: 0.65rem;
	}

	.tutorial-chapter-menu {
		background: #f8fafc;
		border-bottom: 1px solid #e2e8f0;
		padding: 4px;
	}

	.tutorial-chapter-menu-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 12px;
		font-size: 0.8rem;
		border: none;
		background: none;
		border-radius: 8px;
		cursor: pointer;
		color: #475569;
	}

	.tutorial-chapter-menu-item:hover {
		background: #e2e8f0;
	}

	.tutorial-chapter-menu-item.active {
		background: #dbeafe;
		color: #1d4ed8;
		font-weight: 600;
	}

	.tutorial-content {
		padding: 16px 16px 8px;
	}

	.tutorial-title {
		font-size: 1rem;
		font-weight: 700;
		color: #1e293b;
		margin: 0 0 6px;
	}

	.tutorial-description {
		font-size: 0.85rem;
		color: #475569;
		line-height: 1.5;
		margin: 0;
	}

	.tutorial-progress {
		padding: 8px 16px;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.tutorial-progress-text {
		font-size: 0.7rem;
		color: #94a3b8;
		white-space: nowrap;
		min-width: 36px;
	}

	.tutorial-progress-bar {
		flex: 1;
		height: 4px;
		background: #e2e8f0;
		border-radius: 2px;
		overflow: hidden;
	}

	.tutorial-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #3b82f6, #8b5cf6);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.tutorial-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px 12px;
		gap: 8px;
	}

	.tutorial-nav-right {
		display: flex;
		gap: 6px;
	}

	.tutorial-nav-btn {
		padding: 6px 14px;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}

	.tutorial-nav-end {
		background: #f1f5f9;
		color: #64748b;
	}

	.tutorial-nav-end:hover {
		background: #e2e8f0;
	}

	.tutorial-nav-prev {
		background: #f1f5f9;
		color: #475569;
	}

	.tutorial-nav-prev:hover {
		background: #e2e8f0;
	}

	.tutorial-nav-next {
		background: linear-gradient(135deg, #3b82f6, #2563eb);
		color: white;
	}

	.tutorial-nav-next:hover {
		background: linear-gradient(135deg, #2563eb, #1d4ed8);
	}

	.tutorial-nav-next:active {
		transform: scale(0.97);
	}

	/* 年齢帯別フォントサイズ調整 (G3) */
	:global([data-age-tier="baby"]) .tutorial-title,
	:global([data-age-tier="kinder"]) .tutorial-title {
		font-size: 1.25rem;
	}

	:global([data-age-tier="baby"]) .tutorial-description,
	:global([data-age-tier="kinder"]) .tutorial-description {
		font-size: 1.05rem;
	}

	:global([data-age-tier="lower"]) .tutorial-title {
		font-size: 1.125rem;
	}

	:global([data-age-tier="lower"]) .tutorial-description {
		font-size: 0.95rem;
	}
</style>
