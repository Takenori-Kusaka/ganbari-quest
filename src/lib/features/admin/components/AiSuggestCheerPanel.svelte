<script lang="ts">
// AI 応援提案 panel (#2273)
//
// 出来事テキスト → P 値 + カテゴリ + アイコン + 理由要約推定。
// AiSuggestRewardPanel と入力プロンプト・出力意味が異なるため別 component。
// 共通: ProgressMessage / Button / Card / error 表示 / plan gate / locked badge。
// 別:   入力プロンプト / 出力スキーマ / endpoint / labels namespace。
// 重複コード ≤ 10 行で別 component 化 (ADR-0014 OSS 先調査原則整合)。

import { FEATURES_LABELS } from '$lib/domain/labels';
import ProgressMessage from '$lib/ui/components/ProgressMessage.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

export interface CheerPreviewData {
	reason: string;
	points: number;
	icon: string;
	category: string;
	source: string;
}

interface Props {
	onaccept: (preview: CheerPreviewData) => void;
	isFamily?: boolean;
}

let { onaccept, isFamily = false }: Props = $props();

let aiInput = $state('');
let aiLoading = $state(false);
let aiError = $state('');
let aiPreview = $state<CheerPreviewData | null>(null);

const COMMON = FEATURES_LABELS.aiSuggestCommon;
const L = FEATURES_LABELS.aiSuggestCheer;

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
		const res = await fetch('/api/v1/cheer/suggest', {
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
	data-testid="ai-suggest-cheer-panel"
	data-plan-locked={!isFamily}
>
	<h3 class="font-bold text-[var(--color-premium)]">
		{L.title}
		{#if !isFamily}
			<span
				class="ml-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle"
				data-testid="ai-suggest-cheer-locked-badge"
			>{COMMON.familyOnlyBadge}</span>
		{/if}
	</h3>
	<p class="text-xs text-[var(--color-premium-light)]">
		{L.description}
	</p>
	{#if !isFamily}
		<div
			class="bg-[var(--color-surface-card)] rounded-lg p-3 text-xs space-y-2 border border-[var(--color-border-premium)]"
			data-testid="ai-suggest-cheer-upgrade-card"
		>
			<p class="text-[var(--color-text-primary)]">
				{COMMON.familyOnlyDescription(L.kind)}
			</p>
			<a
				href="/pricing"
				class="inline-block px-3 py-1.5 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg font-bold hover:opacity-90 transition-colors"
				data-testid="ai-suggest-cheer-upgrade-cta"
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
				<p class="text-xs text-[var(--color-feedback-warning-text)] bg-[var(--color-feedback-warning-bg)] px-2 py-1 rounded">{COMMON.fallbackNote}</p>
			{/if}
			<div class="flex items-center gap-3">
				<span class="text-3xl">{aiPreview.icon}</span>
				<div class="flex-1">
					<p class="font-bold text-[var(--color-text)]">{L.reasonLabel}: {aiPreview.reason}</p>
					<p class="text-xs text-[var(--color-text-disabled)]">
						{aiPreview.category} / +{aiPreview.points}P
					</p>
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
