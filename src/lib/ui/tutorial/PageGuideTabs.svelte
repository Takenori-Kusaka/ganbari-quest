<script lang="ts">
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
import type { GuideStep } from '$lib/ui/tutorial/page-guide-types';

interface Props {
	step: GuideStep;
}

let { step }: Props = $props();

// 三部構成の表示タブ
let activeTab = $state<'what' | 'how' | 'goal'>('what');

// ステップ切替時にタブをリセット (step.id 変化で発火)
$effect(() => {
	// step.id を読むだけで dependency に登録される
	void step.id;
	activeTab = 'what';
});
</script>

<!-- Tab navigation -->
<div class="guide-tabs">
	<button
		class="guide-tab"
		class:active={activeTab === 'what'}
		onclick={() => (activeTab = 'what')}
	>
		{UI_COMPONENTS_LABELS.pageGuideTabWhat}
	</button>
	<button
		class="guide-tab"
		class:active={activeTab === 'how'}
		onclick={() => (activeTab = 'how')}
	>
		{UI_COMPONENTS_LABELS.pageGuideTabHow}
	</button>
	<button
		class="guide-tab"
		class:active={activeTab === 'goal'}
		onclick={() => (activeTab = 'goal')}
	>
		{UI_COMPONENTS_LABELS.pageGuideTabGoal}
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
			<span class="guide-tips-label">{UI_COMPONENTS_LABELS.pageGuideTipsLabel}</span>
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

<style>
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
</style>
