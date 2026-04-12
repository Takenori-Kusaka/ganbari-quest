<script lang="ts">
import ProgressMessage from '$lib/ui/components/ProgressMessage.svelte';

export interface RewardPreviewData {
	title: string;
	points: number;
	icon: string;
	category: string;
	source: string;
}

interface Props {
	onaccept: (preview: RewardPreviewData) => void;
	isFamily?: boolean;
}

let { onaccept, isFamily = false }: Props = $props();

let aiInput = $state('');
let aiLoading = $state(false);
let aiError = $state('');
let aiPreview = $state<RewardPreviewData | null>(null);

async function suggestFromAI() {
	if (!aiInput.trim()) return;
	if (!isFamily) {
		aiError = 'AI ごほうび提案はファミリープランでご利用いただけます';
		return;
	}
	aiLoading = true;
	aiError = '';
	aiPreview = null;
	try {
		const res = await fetch('/api/v1/special-rewards/suggest', {
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
	data-testid="ai-suggest-reward-panel"
	data-plan-locked={!isFamily}
>
	<h3 class="font-bold text-[var(--color-premium)]">
		✨ どんなごほうびがいい？
		{#if !isFamily}
			<span
				class="ml-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle"
				data-testid="ai-suggest-reward-locked-badge"
			>ファミリー限定</span>
		{/if}
	</h3>
	<p class="text-xs text-[var(--color-premium-light)]">
		ごほうびの内容を自由に入力すると、カテゴリ・ポイント・アイコンを自動で提案します
	</p>
	{#if !isFamily}
		<div
			class="bg-[var(--color-surface-card)] rounded-lg p-3 text-xs space-y-2 border border-[var(--color-border-premium)]"
			data-testid="ai-suggest-reward-upgrade-card"
		>
			<p class="text-[var(--color-text-primary)]">
				AI ごほうび提案はファミリープランで解放されます。
			</p>
			<a
				href="/pricing"
				class="inline-block px-3 py-1.5 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg font-bold hover:opacity-90 transition-colors"
				data-testid="ai-suggest-reward-upgrade-cta"
			>
				ファミリープランにアップグレード
			</a>
		</div>
	{/if}
	<div class="flex gap-2">
		<input
			type="text"
			bind:value={aiInput}
			placeholder="例: おもちゃ、外食、ゲーム時間+30分、おこづかい500円"
			class="flex-1 px-3 py-2 border rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
			disabled={!isFamily}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); suggestFromAI(); } }}
		/>
		<button
			type="button"
			class="px-4 py-2 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg text-sm font-bold hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			disabled={!isFamily || aiLoading || !aiInput.trim()}
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
				<p class="text-xs text-[var(--color-feedback-warning-text)] bg-[var(--color-feedback-warning-bg)] px-2 py-1 rounded">AIが利用できなかったため、入力内容から推定しました</p>
			{/if}
			<div class="flex items-center gap-3">
				<span class="text-3xl">{aiPreview.icon}</span>
				<div class="flex-1">
					<p class="font-bold text-[var(--color-text)]">{aiPreview.title}</p>
					<p class="text-xs text-[var(--color-text-disabled)]">
						{aiPreview.category} / {aiPreview.points}P
					</p>
				</div>
			</div>
			<div class="flex gap-2">
				<button
					type="button"
					class="flex-1 py-2 bg-[var(--color-action-success)] text-[var(--color-text-inverse)] rounded-lg font-bold text-sm hover:opacity-90 transition-colors"
					onclick={acceptPreview}
				>
					この内容で入力する
				</button>
				<button
					type="button"
					class="px-4 py-2 bg-[var(--color-surface-muted-strong)] rounded-lg font-bold text-sm hover:bg-[var(--color-surface-tertiary)] transition-colors"
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
