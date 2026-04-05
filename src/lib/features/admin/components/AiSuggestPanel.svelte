<script lang="ts">
import { splitIcon } from '$lib/domain/icon-utils';
import { getCategoryById } from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import ProgressMessage from '$lib/ui/components/ProgressMessage.svelte';
import type { AiPreviewData } from './activity-types';

interface Props {
	onaccept: (preview: AiPreviewData) => void;
}

let { onaccept }: Props = $props();

let aiInput = $state('');
let aiLoading = $state(false);
let aiError = $state('');
let aiPreview = $state<AiPreviewData | null>(null);

async function suggestFromAI() {
	if (!aiInput.trim()) return;
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
			aiError = json.error?.message ?? '推定に失敗しました';
		}
	} catch {
		aiError = 'ネットワークエラーが発生しました';
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

<div class="bg-[var(--color-stat-purple-bg)] rounded-xl p-4 shadow-sm space-y-3 border border-[var(--color-premium-bg)]">
	<h3 class="font-bold text-[var(--color-premium)]">✨ やりたいことを教えてください</h3>
	<p class="text-xs text-[var(--color-premium)]">
		やりたい活動を自由に入力すると、カテゴリ・ポイント・アイコンを自動で提案します
	</p>
	<div class="flex gap-2">
		<input
			type="text"
			bind:value={aiInput}
			placeholder="例: ピアノの練習をした、公園で走った、折り紙を作った"
			class="flex-1 px-3 py-2 border rounded-lg text-sm"
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); suggestFromAI(); } }}
		/>
		<button
			type="button"
			class="px-4 py-2 bg-[var(--color-stat-purple)] text-white rounded-lg text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50"
			disabled={aiLoading || !aiInput.trim()}
			onclick={suggestFromAI}
		>
			{#if aiLoading}
				<span class="ai-spinner" aria-hidden="true"></span>
				考え中...
			{:else}
				提案する
			{/if}
		</button>
	</div>
	{#if aiLoading}
		<ProgressMessage
			messages={['AIに聞いています...', 'もうちょっと待ってね...', 'あとすこし...']}
			intervalMs={3000}
		/>
	{/if}
	{#if aiError}
		<p class="text-[var(--color-feedback-error-text)] text-sm">{aiError}</p>
	{/if}

	{#if aiPreview}
		<div class="bg-[var(--color-surface-card)] rounded-lg p-3 space-y-2 border border-[var(--color-premium-bg)]">
			{#if aiPreview.source === 'fallback'}
				<p class="text-xs text-[var(--color-feedback-warning-text)] bg-[var(--color-feedback-warning-bg)] px-2 py-1 rounded">AIが利用できなかったため、入力内容から推定しました</p>
			{/if}
			<div class="flex items-center gap-3">
				<CompoundIcon icon={aiPreview.icon} size="lg" />
				<div class="flex-1">
					<p class="font-bold text-[var(--color-text)]">{aiPreview.nameKanji || aiPreview.name}</p>
					<p class="text-xs text-[var(--color-text-muted)]">
						{getCategoryById(aiPreview.categoryId)?.name ?? ''} / {aiPreview.basePoints}P
					</p>
					{#if aiPreview.nameKana || aiPreview.nameKanji}
						<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
							{#if aiPreview.nameKana}ひらがな: {aiPreview.nameKana}{/if}
							{#if aiPreview.nameKana && aiPreview.nameKanji} / {/if}
							{#if aiPreview.nameKanji}漢字: {aiPreview.nameKanji}{/if}
						</p>
					{/if}
				</div>
			</div>
			<div class="flex gap-2">
				<button
					type="button"
					class="flex-1 py-2 bg-[var(--color-action-success)] text-white rounded-lg font-bold text-sm hover:brightness-110 transition-all"
					onclick={acceptPreview}
				>
					この内容で追加フォームを開く
				</button>
				<button
					type="button"
					class="px-4 py-2 bg-[var(--color-neutral-200)] rounded-lg font-bold text-sm hover:bg-[var(--color-neutral-300)] transition-colors"
					onclick={() => aiPreview = null}
				>
					やり直す
				</button>
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
