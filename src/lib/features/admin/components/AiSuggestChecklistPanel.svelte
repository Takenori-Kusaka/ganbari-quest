<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';
import ProgressMessage from '$lib/ui/components/ProgressMessage.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

export interface ChecklistItemPreview {
	name: string;
	icon: string;
	frequency: string;
	direction: string;
}

export interface ChecklistPreviewData {
	templateName: string;
	templateIcon: string;
	items: ChecklistItemPreview[];
	source: string;
}

interface Props {
	onaccept: (preview: ChecklistPreviewData) => void;
	isFamily?: boolean;
}

let { onaccept, isFamily = false }: Props = $props();

let aiInput = $state('');
let aiLoading = $state(false);
let aiError = $state('');
let aiPreview = $state<ChecklistPreviewData | null>(null);

const COMMON = FEATURES_LABELS.aiSuggestCommon;
const L = FEATURES_LABELS.aiSuggestChecklist;

async function suggestFromAI() {
	if (!aiInput.trim()) return;
	if (!isFamily) {
		aiError = COMMON.familyOnlyError(L.kind);
		return;
	}
	aiLoading = true;
	aiError = '';
	aiPreview = null;
	try {
		const res = await fetch('/api/v1/checklists/suggest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: aiInput }),
		});
		const json = await res.json();
		if (res.ok) {
			aiPreview = json;
		} else {
			aiError = json.error?.message ?? COMMON.errorEstimate;
		}
	} catch {
		aiError = COMMON.errorNetwork;
	} finally {
		aiLoading = false;
	}
}

function acceptPreview() {
	if (!aiPreview) return;
	onaccept(aiPreview);
	aiPreview = null;
}

const FREQ_LABELS: Record<string, string> = {
	daily: L.freqDaily,
	'weekday:月': '月',
	'weekday:火': '火',
	'weekday:水': '水',
	'weekday:木': '木',
	'weekday:金': '金',
	'weekday:土': '土',
};

const DIR_LABELS: Record<string, string> = {
	bring: L.dirBring,
	return: L.dirReturn,
	both: L.dirBoth,
};
</script>

<div
	class="bg-[var(--color-premium-bg)] rounded-xl p-4 shadow-sm space-y-3 border border-[var(--color-border-premium)]"
	data-testid="ai-suggest-checklist-panel"
	data-plan-locked={!isFamily}
>
	<h3 class="font-bold text-[var(--color-premium)]">
		{L.title}
		{#if !isFamily}
			<span
				class="ml-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle"
				data-testid="ai-suggest-checklist-locked-badge"
			>{COMMON.familyOnlyBadge}</span>
		{/if}
	</h3>
	<p class="text-xs text-[var(--color-premium-light)]">
		{L.description}
	</p>
	{#if !isFamily}
		<div
			class="bg-[var(--color-surface-card)] rounded-lg p-3 text-xs space-y-2 border border-[var(--color-border-premium)]"
			data-testid="ai-suggest-checklist-upgrade-card"
		>
			<p class="text-[var(--color-text-primary)]">
				{COMMON.familyOnlyDescription(L.kind)}
			</p>
			<a
				href="/pricing"
				class="inline-block px-3 py-1.5 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg font-bold hover:opacity-90 transition-colors"
				data-testid="ai-suggest-checklist-upgrade-cta"
			>
				{COMMON.familyUpgradeBtn}
			</a>
		</div>
	{/if}
	<div class="flex gap-2">
		<input
			type="text"
			bind:value={aiInput}
			placeholder={L.placeholder}
			class="flex-1 px-3 py-2 border rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
			disabled={!isFamily}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); suggestFromAI(); } }}
		/>
		<Button
			type="button"
			variant="primary"
			size="sm"
			disabled={!isFamily || aiLoading || !aiInput.trim()}
			onclick={suggestFromAI}
		>
			{#if aiLoading}
				<span class="ai-spinner" aria-hidden="true"></span>
				{COMMON.thinkingLabel}
			{:else}
				{COMMON.suggestBtn}
			{/if}
		</Button>
	</div>
	{#if aiLoading}
		<ProgressMessage
			messages={[COMMON.progressBaseAi, COMMON.progressChecklistThinking, COMMON.progressBaseFinal]}
			intervalMs={3000}
		/>
	{/if}
	{#if aiError}
		<p class="text-[var(--color-action-danger)] text-sm">{aiError}</p>
	{/if}

	{#if aiPreview}
		<div class="bg-[var(--color-surface-card)] rounded-lg p-3 space-y-2 border border-[var(--color-border-premium)]">
			{#if aiPreview.source === 'fallback'}
				<p class="text-xs text-[var(--color-feedback-warning-text)] bg-[var(--color-feedback-warning-bg)] px-2 py-1 rounded">{COMMON.fallbackNote}</p>
			{/if}
			<div class="flex items-center gap-2 mb-2">
				<span class="text-2xl">{aiPreview.templateIcon}</span>
				<span class="font-bold text-[var(--color-text)]">{aiPreview.templateName}</span>
				<span class="text-xs text-[var(--color-text-disabled)]">{L.itemCount(aiPreview.items.length)}</span>
			</div>
			<div class="space-y-1 max-h-60 overflow-y-auto">
				{#each aiPreview.items as item, i}
					<div class="flex items-center gap-2 px-2 py-1 rounded bg-[var(--color-surface-muted)]">
						<span class="text-sm w-5 text-center text-[var(--color-text-disabled)]">{i + 1}</span>
						<span>{item.icon}</span>
						<span class="text-sm flex-1">{item.name}</span>
						<span class="text-xs px-1.5 py-0.5 bg-[var(--color-feedback-info-bg)] text-[var(--color-feedback-info-text)] rounded">{FREQ_LABELS[item.frequency] ?? item.frequency}</span>
						<span class="text-xs px-1.5 py-0.5 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] rounded">{DIR_LABELS[item.direction] ?? item.direction}</span>
					</div>
				{/each}
			</div>
			<div class="flex gap-2 mt-2">
				<Button
					type="button"
					variant="primary"
					size="sm"
					class="flex-1"
					onclick={acceptPreview}
				>
					{L.acceptBtn}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="bg-[var(--color-surface-muted-strong)] hover:bg-[var(--color-surface-tertiary)]"
					onclick={() => aiPreview = null}
				>
					{COMMON.retryBtn}
				</Button>
			</div>
		</div>
	{/if}
</div>

<style>
	.ai-spinner {
		display: inline-block;
		width: 1em;
		height: 1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		vertical-align: middle;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
