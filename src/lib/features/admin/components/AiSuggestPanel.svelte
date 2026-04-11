<script lang="ts">
import { splitIcon } from '$lib/domain/icon-utils';
import { getCategoryById } from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import ProgressMessage from '$lib/ui/components/ProgressMessage.svelte';
import type { AiPreviewData } from './activity-types';

interface Props {
	onaccept: (preview: AiPreviewData) => void;
	isPremium?: boolean;
}

let { onaccept, isPremium = false }: Props = $props();

let aiInput = $state('');
let aiLoading = $state(false);
let aiError = $state('');
let aiPreview = $state<AiPreviewData | null>(null);

async function suggestFromAI() {
	if (!aiInput.trim()) return;
	if (!isPremium) {
		aiError = 'AI 活動提案はスタンダードプラン以上でご利用いただけます';
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

<div
	class="bg-[var(--color-premium-bg)] rounded-xl p-4 shadow-sm space-y-3 border border-[var(--color-border-premium)]"
	data-testid="ai-suggest-panel"
	data-plan-locked={!isPremium}
>
	<h3 class="font-bold text-[var(--color-premium)]">
		✨ やりたいことを教えてください
		{#if !isPremium}
			<span
				class="ml-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle"
				data-testid="ai-suggest-locked-badge"
			>スタンダード限定</span>
		{/if}
	</h3>
	<p class="text-xs text-[var(--color-premium-light)]">
		やりたい活動を自由に入力すると、カテゴリ・ポイント・アイコンを自動で提案します
	</p>
	{#if !isPremium}
		<div
			class="bg-[var(--color-surface-card)] rounded-lg p-3 text-xs space-y-2 border border-[var(--color-border-premium)]"
			data-testid="ai-suggest-upgrade-card"
		>
			<p class="text-[var(--color-text-primary)]">
				AI 活動提案はスタンダードプラン以上で解放されます。
			</p>
			<a
				href="/admin/license"
				class="inline-block px-3 py-1.5 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg font-bold hover:opacity-90 transition-colors"
				data-testid="ai-suggest-upgrade-cta"
			>
				スタンダードで解放する
			</a>
		</div>
	{/if}
	<div class="flex gap-2">
		<input
			type="text"
			bind:value={aiInput}
			placeholder="例: ピアノの練習をした、公園で走った、折り紙を作った"
			class="flex-1 px-3 py-2 border rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
			disabled={!isPremium}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); suggestFromAI(); } }}
		/>
		<button
			type="button"
			class="px-4 py-2 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg text-sm font-bold hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			disabled={!isPremium || aiLoading || !aiInput.trim()}
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
		<p class="text-[var(--color-action-danger)] text-sm">{aiError}</p>
	{/if}

	{#if aiPreview}
		<div class="bg-[var(--color-surface-card)] rounded-lg p-3 space-y-2 border border-[var(--color-border-premium)]">
			{#if aiPreview.source === 'fallback'}
				<p class="text-xs text-[var(--color-warning)] bg-[var(--color-gold-100)] px-2 py-1 rounded">AIが利用できなかったため、入力内容から推定しました</p>
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
					class="flex-1 py-2 bg-[var(--color-action-success)] text-[var(--color-text-inverse)] rounded-lg font-bold text-sm hover:opacity-90 transition-colors"
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
