<script lang="ts">
import { splitIcon } from '$lib/domain/icon-utils';
import { FEATURES_LABELS } from '$lib/domain/labels';
import { getCategoryById } from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import ProgressMessage from '$lib/ui/components/ProgressMessage.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import type { AiPreviewData } from './activity-types';

interface Props {
	onaccept: (preview: AiPreviewData) => void;
	isFamily?: boolean;
}

let { onaccept, isFamily = false }: Props = $props();

let aiInput = $state('');
let aiLoading = $state(false);
let aiError = $state('');
let aiPreview = $state<AiPreviewData | null>(null);

const COMMON = FEATURES_LABELS.aiSuggestCommon;
const L = FEATURES_LABELS.aiSuggestActivity;

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
		const res = await fetch('/api/v1/activities/suggest', {
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
</script>

<div
	class="bg-[var(--color-premium-bg)] rounded-xl p-4 shadow-sm space-y-3 border border-[var(--color-border-premium)]"
	data-testid="ai-suggest-panel"
	data-plan-locked={!isFamily}
>
	<h3 class="font-bold text-[var(--color-premium)]">
		{L.title}
		{#if !isFamily}
			<span
				class="ml-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle"
				data-testid="ai-suggest-locked-badge"
			>{COMMON.familyOnlyBadge}</span>
		{/if}
	</h3>
	<p class="text-xs text-[var(--color-premium-light)]">
		{L.description}
	</p>
	{#if !isFamily}
		<div
			class="bg-[var(--color-surface-card)] rounded-lg p-3 text-xs space-y-2 border border-[var(--color-border-premium)]"
			data-testid="ai-suggest-upgrade-card"
		>
			<p class="text-[var(--color-text-primary)]">
				{COMMON.familyOnlyDescription(L.kind)}
			</p>
			<a
				href="/admin/license"
				class="inline-block px-3 py-1.5 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg font-bold hover:opacity-90 transition-colors"
				data-testid="ai-suggest-upgrade-cta"
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
			messages={[COMMON.progressBaseAi, COMMON.progressBaseWait, COMMON.progressBaseFinal]}
			intervalMs={3000}
		/>
	{/if}
	{#if aiError}
		<p class="text-[var(--color-action-danger)] text-sm">{aiError}</p>
	{/if}

	{#if aiPreview}
		<div class="bg-[var(--color-surface-card)] rounded-lg p-3 space-y-2 border border-[var(--color-border-premium)]">
			{#if aiPreview.source === 'fallback'}
				<p class="text-xs text-[var(--color-warning)] bg-[var(--color-gold-100)] px-2 py-1 rounded">{COMMON.fallbackNote}</p>
			{/if}
			<div class="flex items-center gap-3">
				<CompoundIcon icon={aiPreview.icon} size="lg" />
				<div class="flex-1">
					<p class="font-bold text-[var(--color-text)]">{aiPreview.nameKanji || aiPreview.name}</p>
					<p class="text-xs text-[var(--color-text-disabled)]">
						{getCategoryById(aiPreview.categoryId)?.name ?? ''} / {aiPreview.basePoints}P
					</p>
					{#if aiPreview.nameKana || aiPreview.nameKanji}
						<p class="text-xs text-[var(--color-text-disabled)] mt-0.5">
							{#if aiPreview.nameKana}{L.previewKana(aiPreview.nameKana)}{/if}
							{#if aiPreview.nameKana && aiPreview.nameKanji} / {/if}
							{#if aiPreview.nameKanji}{L.previewKanji(aiPreview.nameKanji)}{/if}
						</p>
					{/if}
				</div>
			</div>
			<div class="flex gap-2">
				<Button
					type="button"
					variant="success"
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
